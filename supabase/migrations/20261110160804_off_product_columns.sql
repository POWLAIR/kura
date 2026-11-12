-- Produits Open Food Facts mis en cache dans food_ref (issue #25), et totaux des repas pour
-- les produits vendus au volume (issue #57).
-- La fonction off-product est seule à écrire ces lignes (source = 'off', code = EAN) ;
-- les utilisateurs connectés les lisent, comme le reste du référentiel.

alter table public.food_ref
  add column brand text,
  add column package_quantity numeric check (package_quantity > 0),
  add column package_unit public.quantity_unit check (package_unit in ('g', 'ml')),
  -- Ciqual : toujours pour 100 g (valeur par défaut). Open Food Facts : g, ml, ou null quand
  -- la fiche ne dit pas si le produit se vend au poids ou au volume.
  add column per_100_unit public.quantity_unit default 'g'
    check (per_100_unit in ('g', 'ml')),
  add constraint food_ref_package_check
    check ((package_quantity is null) = (package_unit is null));

comment on column public.food_ref.brand is 'Marque du produit (Open Food Facts).';
comment on column public.food_ref.package_quantity is
  'Contenance de l''emballage (Open Food Facts), dans package_unit : sert à proposer une quantité au scan.';
comment on column public.food_ref.package_unit is 'Unité de package_quantity : g ou ml.';
comment on column public.food_ref.per_100_unit is
  'Base des valeurs nutritionnelles : pour 100 g, pour 100 ml (produit vendu au volume), ou null si elle est inconnue : l''aliment n''est alors pas compté dans les totaux.';

-- ---------------------------------------------------------------------------
-- Totaux d'un repas : valeurs pour 100 g ou pour 100 ml
-- ---------------------------------------------------------------------------

-- Quantité d'un aliment dans la base de ses valeurs (g ou ml), ou null s'il ne peut pas
-- être compté : le repas est alors « valeurs partielles ». Rien n'est estimé :
--   - valeurs pour 100 g : la quantité en grammes (voir to_grams) ;
--   - valeurs pour 100 ml : la quantité dite en ml, telle quelle ; dite en g ou en pièces,
--     il faut la densité donnée par l'utilisateur ;
--   - base inconnue : jamais compté.
create function public.nutrition_amount(
  p_per_100_unit public.quantity_unit,
  p_quantity numeric,
  p_unit public.quantity_unit,
  p_quantity_g numeric,
  p_density_g_ml numeric
)
returns numeric
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_per_100_unit = 'g' then p_quantity_g
    when p_per_100_unit = 'ml' and p_unit = 'ml' then p_quantity
    when p_per_100_unit = 'ml' then p_quantity_g / nullif(p_density_g_ml, 0)
  end;
$$;

-- Inchangée sauf la quantité comptée, qui suit la base des valeurs de l'aliment.
create or replace function public.meal_totals(p_meal_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with items as (
    select
      public.nutrition_amount(
        f.per_100_unit, mi.quantity, mi.unit, mi.quantity_g, c.density_g_ml
      ) as counted_amount,
      f.*
    from public.meal_item mi
    join public.food_ref f on f.id = mi.food_ref_id
    left join public.food_conversion c on c.food_ref_id = f.id and c.user_id = mi.user_id
    where mi.meal_id = p_meal_id
  ),
  counted as (
    select * from items where counted_amount is not null
  ),
  amounts as (
    select kv.key, kv.value::numeric * c.counted_amount / 100 as amount
    from counted c
    cross join lateral jsonb_each(
      jsonb_strip_nulls(jsonb_build_object(
        'energy_kcal', c.energy_kcal,
        'protein_g', c.protein_g,
        'carbs_g', c.carbs_g,
        'sugars_g', c.sugars_g,
        'fat_g', c.fat_g,
        'saturated_fat_g', c.saturated_fat_g,
        'fiber_g', c.fiber_g,
        'salt_g', c.salt_g
      )) || c.micronutrients || c.nutrient_details
    ) as kv
  ),
  per_key as (
    select key, round(sum(amount), 3) as total, count(*) as n
    from amounts
    group by key
  )
  select jsonb_build_object(
    'values', coalesce((select jsonb_object_agg(key, total) from per_key), '{}'::jsonb),
    'incomplete', coalesce(
      (select jsonb_agg(key order by key) from per_key where n < (select count(*) from counted)),
      '[]'::jsonb
    )
  );
$$;

-- Un repas est partiel dès qu'un aliment n'est pas compté : sans référence, sans conversion
-- possible, ou de base inconnue.
create or replace function public.refresh_meal(p_meal_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.meal
  set
    nutrition_totals = public.meal_totals(p_meal_id),
    partial_values = exists (
      select 1
      from public.meal_item mi
      left join public.food_ref f on f.id = mi.food_ref_id
      left join public.food_conversion c
        on c.food_ref_id = mi.food_ref_id and c.user_id = mi.user_id
      where mi.meal_id = p_meal_id
        and public.nutrition_amount(
          f.per_100_unit, mi.quantity, mi.unit, mi.quantity_g, c.density_g_ml
        ) is null
    )
  where id = p_meal_id;
$$;

-- Inchangée sauf la liste des repas recalculés : pour un aliment dont les valeurs sont pour
-- 100 ml, la densité change aussi le total des repas où il est dit en grammes.
create or replace function public.set_food_conversion(p_food_ref_id bigint, p_changes jsonb)
returns table (piece_weight_g numeric, density_g_ml numeric, meals_updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key text;
  v_old public.food_conversion;
  v_piece numeric;
  v_density numeric;
  v_meals bigint[];
  v_meal bigint;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes = '{}'::jsonb then
    raise exception 'Aucune modification demandée' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key <> all (array['piece_weight_g', 'density_g_ml']) then
      raise exception 'Champ inconnu : %', v_key using errcode = '22023';
    end if;
  end loop;
  if not exists (select 1 from public.food_ref f where f.id = p_food_ref_id) then
    raise exception 'Aliment de référence inconnu' using errcode = '22023';
  end if;

  select * into v_old from public.food_conversion c
  where c.food_ref_id = p_food_ref_id and c.user_id = (select auth.uid())
  for update;
  v_piece := case when p_changes ? 'piece_weight_g'
    then (p_changes ->> 'piece_weight_g')::numeric else v_old.piece_weight_g end;
  v_density := case when p_changes ? 'density_g_ml'
    then (p_changes ->> 'density_g_ml')::numeric else v_old.density_g_ml end;

  if v_piece is null and v_density is null then
    delete from public.food_conversion c
    where c.food_ref_id = p_food_ref_id and c.user_id = (select auth.uid());
  else
    insert into public.food_conversion (food_ref_id, piece_weight_g, density_g_ml)
    values (p_food_ref_id, v_piece, v_density)
    on conflict (user_id, food_ref_id) do update
      set piece_weight_g = excluded.piece_weight_g, density_g_ml = excluded.density_g_ml;
  end if;

  with converted as (
    select mi.id, mi.meal_id, public.to_grams(
      mi.quantity, mi.unit, coalesce(v_piece, f.piece_weight_g), v_density
    ) as quantity_g
    from public.meal_item mi
    join public.food_ref f on f.id = mi.food_ref_id
    where mi.food_ref_id = p_food_ref_id and mi.unit in ('piece', 'ml')
      and mi.user_id = (select auth.uid())
  ),
  changed as (
    update public.meal_item mi
    set quantity_g = cv.quantity_g
    from converted cv
    where mi.id = cv.id and mi.quantity_g is distinct from cv.quantity_g
    returning mi.meal_id
  ),
  -- Valeurs pour 100 ml : la densité compte aussi pour les quantités dites en g ou en pièces.
  by_volume as (
    select mi.meal_id
    from public.meal_item mi
    join public.food_ref f on f.id = mi.food_ref_id
    where mi.food_ref_id = p_food_ref_id and f.per_100_unit = 'ml' and mi.unit <> 'ml'
      and v_density is distinct from v_old.density_g_ml
      and mi.user_id = (select auth.uid())
  )
  select array_agg(distinct touched.meal_id) into v_meals
  from (select meal_id from changed union select meal_id from by_volume) as touched;

  foreach v_meal in array coalesce(v_meals, '{}') loop
    perform public.refresh_meal(v_meal);
  end loop;

  return query select v_piece, v_density, coalesce(cardinality(v_meals), 0);
end;
$$;

revoke all on function public.nutrition_amount(
  public.quantity_unit, numeric, public.quantity_unit, numeric, numeric
) from public, anon;
grant execute on function public.nutrition_amount(
  public.quantity_unit, numeric, public.quantity_unit, numeric, numeric
) to authenticated;
