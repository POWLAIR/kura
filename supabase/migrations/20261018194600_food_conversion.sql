-- Poids par pièce et densités donnés par l'utilisateur (issue #20). Voir docs/mcp.md.
--
-- Ciqual n'a ni poids moyen par pièce ni densité : sans eux, « 2 œufs » ou « 15 ml de
-- sauce » rendent le repas partiel. Ces valeurs viennent de l'utilisateur (pesée,
-- emballage), jamais d'une estimation ; elles valent pour lui seul et recalculent ses
-- repas déjà saisis, grâce à la quantité dite gardée dans meal_item.

-- ---------------------------------------------------------------------------
-- food_conversion
-- ---------------------------------------------------------------------------

create table public.food_conversion (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  food_ref_id bigint not null references public.food_ref on delete cascade,
  piece_weight_g numeric check (piece_weight_g > 0),
  density_g_ml numeric check (density_g_ml > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, food_ref_id),
  -- Une ligne sans valeur est supprimée plutôt que gardée vide.
  constraint food_conversion_value_check check (piece_weight_g is not null or density_g_ml is not null)
);

comment on table public.food_conversion is 'Poids d''une pièce et densité d''un aliment, donnés par l''utilisateur. Priment sur food_ref.piece_weight_g.';
comment on column public.food_conversion.density_g_ml is 'Grammes par millilitre, pour convertir les volumes.';

create index food_conversion_food_ref_id_idx on public.food_conversion (food_ref_id);

create trigger food_conversion_set_updated_at
  before update on public.food_conversion
  for each row execute function public.set_updated_at();

alter table public.food_conversion enable row level security;
revoke all on public.food_conversion from anon;
revoke truncate, references, trigger on public.food_conversion from authenticated;

create policy "food_conversion : lecture de ses lignes" on public.food_conversion
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "food_conversion : ajout de ses lignes" on public.food_conversion
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "food_conversion : modification de ses lignes" on public.food_conversion
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "food_conversion : suppression de ses lignes" on public.food_conversion
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Conversion en grammes : la densité s'ajoute
-- ---------------------------------------------------------------------------

drop function public.to_grams(numeric, public.quantity_unit, numeric);

-- Pièce : poids moyen ; ml : densité. Valeur inconnue : null, le repas est partiel.
create function public.to_grams(
  p_quantity numeric,
  p_unit public.quantity_unit,
  p_piece_weight_g numeric,
  p_density_g_ml numeric default null
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
    when 'ml' then p_quantity * p_density_g_ml
  end;
$$;

-- ---------------------------------------------------------------------------
-- Totaux d'un repas, après saisie ou recalcul
-- ---------------------------------------------------------------------------

create function public.refresh_meal(p_meal_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.meal
  set
    nutrition_totals = public.meal_totals(p_meal_id),
    partial_values = exists (
      select 1 from public.meal_item mi
      where mi.meal_id = p_meal_id and (mi.food_ref_id is null or mi.quantity_g is null)
    )
  where id = p_meal_id;
$$;

-- ---------------------------------------------------------------------------
-- log_meal : conversions de l'utilisateur
-- ---------------------------------------------------------------------------

-- Inchangée sauf la conversion : poids et densité de l'utilisateur d'abord, poids de
-- food_ref ensuite. Le filtre sur user_id double la RLS : une ligne d'un autre utilisateur
-- dupliquerait l'aliment.
create or replace function public.log_meal(
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
    public.to_grams(
      (i ->> 'quantity')::numeric,
      (i ->> 'unit')::public.quantity_unit,
      coalesce(c.piece_weight_g, f.piece_weight_g),
      c.density_g_ml
    )
  from jsonb_array_elements(p_items) as i
  left join public.food_ref f on f.id = (i ->> 'food_ref_id')::bigint
  left join public.food_conversion c on c.food_ref_id = f.id and c.user_id = (select auth.uid());

  perform public.refresh_meal(v_meal_id);

  return query select v_meal_id, false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enregistrer une conversion et recalculer les repas
-- ---------------------------------------------------------------------------

-- p_changes : { "piece_weight_g", "density_g_ml" }, l'un ou l'autre ou les deux ; une clé
-- absente garde la valeur actuelle, null la retire. Les repas de l'utilisateur qui
-- contiennent l'aliment en pièces ou en ml sont recalculés, y compris quand une valeur
-- est corrigée ou retirée (ils redeviennent alors partiels).
create function public.set_food_conversion(p_food_ref_id bigint, p_changes jsonb)
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
  )
  select array_agg(distinct changed.meal_id) into v_meals from changed;

  foreach v_meal in array coalesce(v_meals, '{}') loop
    perform public.refresh_meal(v_meal);
  end loop;

  return query select v_piece, v_density, coalesce(cardinality(v_meals), 0);
end;
$$;

-- Réservées aux utilisateurs connectés (EXECUTE est accordé à public par défaut).
revoke all on function public.to_grams(numeric, public.quantity_unit, numeric, numeric) from public, anon;
grant execute on function public.to_grams(numeric, public.quantity_unit, numeric, numeric) to authenticated;
revoke all on function public.refresh_meal(bigint) from public, anon;
grant execute on function public.refresh_meal(bigint) to authenticated;
revoke all on function public.set_food_conversion(bigint, jsonb) from public, anon;
grant execute on function public.set_food_conversion(bigint, jsonb) to authenticated;
