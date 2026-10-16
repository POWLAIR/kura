-- Suivi des repas (issue #8). Voir docs/mcp.md.
--
-- Les totaux nutritionnels sont calculés ici, depuis food_ref, jamais par un LLM. Un
-- aliment sans référence ou sans poids en grammes rend le repas « valeurs partielles ».

-- ---------------------------------------------------------------------------
-- meal_item : aliment tel que dit, et quantité d'origine
-- ---------------------------------------------------------------------------

-- Un aliment sans équivalent dans food_ref (sauce de marque…) est gardé par son nom ;
-- il ne compte pas dans les totaux et rend le repas partiel.
alter table public.meal_item alter column food_ref_id drop not null;

alter table public.meal_item
  add column name text check (length(trim(name)) > 0),
  -- Quantité dite (« 2 pièces », « 250 ml ») : quantity_g en est la conversion, quand elle
  -- est possible. Gardée pour recalculer si un poids moyen ou une densité arrive plus tard.
  add column quantity numeric check (quantity > 0),
  add column unit public.quantity_unit,
  add constraint meal_item_amount_check check ((quantity is null) = (unit is null)),
  add constraint meal_item_food_check check (food_ref_id is not null or name is not null);

comment on column public.meal_item.name is 'Aliment tel que dit (« riz basmati »), obligatoire sans food_ref.';

-- ---------------------------------------------------------------------------
-- Conversion en grammes
-- ---------------------------------------------------------------------------

-- Pièce : poids moyen de food_ref, s'il est connu. ml : impossible sans densité. Jamais
-- d'estimation : null rend le repas partiel.
create function public.to_grams(
  p_quantity numeric,
  p_unit public.quantity_unit,
  p_piece_weight_g numeric
)
returns numeric
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_unit
    when 'g' then p_quantity
    when 'piece' then p_quantity * p_piece_weight_g
  end;
$$;

-- ---------------------------------------------------------------------------
-- Totaux d'un repas
-- ---------------------------------------------------------------------------

-- { "values": { clé: total }, "incomplete": [clés] }, sur les aliments convertis en grammes.
-- Une clé absente de tous les aliments est « non renseignée » (absente de values) ; une clé
-- absente de certains seulement est listée dans incomplete : son total est un minimum.
-- Réutilisable par cook_recipe (phase 3).
create function public.meal_totals(p_meal_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with counted as (
    select mi.quantity_g, f.*
    from public.meal_item mi
    join public.food_ref f on f.id = mi.food_ref_id
    where mi.meal_id = p_meal_id and mi.quantity_g is not null
  ),
  amounts as (
    select kv.key, kv.value::numeric * c.quantity_g / 100 as amount
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

-- ---------------------------------------------------------------------------
-- Enregistrer un repas
-- ---------------------------------------------------------------------------

-- p_items : [{ "name", "food_ref_id" (ou null), "quantity", "unit" }], unités stockées
-- (g, ml, piece). Rejoué avec la même clé d'idempotence, renvoie le repas existant.
create function public.log_meal(
  p_label text,
  p_items jsonb,
  p_idempotency_key text,
  p_eaten_at timestamptz default null
)
returns table (meal_id bigint, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_meal_id bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Un repas contient au moins un aliment' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as i
    where i ->> 'food_ref_id' is not null
      and not exists (select 1 from public.food_ref f where f.id = (i ->> 'food_ref_id')::bigint)
  ) then
    raise exception 'Aliment de référence inconnu' using errcode = '22023';
  end if;

  insert into public.meal (label, eaten_at, idempotency_key)
  values (trim(p_label), coalesce(p_eaten_at, now()), p_idempotency_key)
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_meal_id;

  if v_meal_id is null then
    return query
      select m.id, true from public.meal m where m.idempotency_key = p_idempotency_key;
    return;
  end if;

  insert into public.meal_item (meal_id, food_ref_id, name, quantity, unit, quantity_g)
  select
    v_meal_id,
    f.id,
    nullif(trim(i ->> 'name'), ''),
    (i ->> 'quantity')::numeric,
    (i ->> 'unit')::public.quantity_unit,
    public.to_grams((i ->> 'quantity')::numeric, (i ->> 'unit')::public.quantity_unit, f.piece_weight_g)
  from jsonb_array_elements(p_items) as i
  left join public.food_ref f on f.id = (i ->> 'food_ref_id')::bigint;

  update public.meal
  set
    nutrition_totals = public.meal_totals(v_meal_id),
    partial_values = exists (
      select 1 from public.meal_item mi
      where mi.meal_id = v_meal_id and (mi.food_ref_id is null or mi.quantity_g is null)
    )
  where id = v_meal_id;

  return query select v_meal_id, false;
end;
$$;

-- Réservées aux utilisateurs connectés (EXECUTE est accordé à public par défaut).
revoke all on function public.to_grams(numeric, public.quantity_unit, numeric) from public, anon;
grant execute on function public.to_grams(numeric, public.quantity_unit, numeric) to authenticated;
revoke all on function public.meal_totals(bigint) from public, anon;
grant execute on function public.meal_totals(bigint) to authenticated;
revoke all on function public.log_meal(text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.log_meal(text, jsonb, text, timestamptz) to authenticated;
