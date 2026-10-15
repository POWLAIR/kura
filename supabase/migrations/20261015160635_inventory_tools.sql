-- Outils d'inventaire partagés par l'app et le serveur MCP (issue #6). Voir docs/mcp.md.
--
-- Lecture : vue inventory_status (aliment lié, indicateur « à racheter »).
-- Écriture : add_item, restock_item, update_item écrivent l'article et son
-- stock_movement dans la même transaction ; idempotent_call rend add_items rejouable. Toutes en security invoker : la RLS de
-- l'utilisateur s'applique, user_id vient de auth.uid().

-- ---------------------------------------------------------------------------
-- Fraction d'un contenant plein, pour les articles suivis en niveau
-- ---------------------------------------------------------------------------

-- Même table que STOCK_LEVEL_FRACTION (packages/core/src/inventory.ts) ; les tests
-- d'intégration du serveur MCP vérifient qu'elles concordent.
create function public.stock_level_fraction(level public.stock_level)
returns numeric
language sql
immutable
security invoker
set search_path = ''
as $$
  select case level
    when 'plein' then 1.0
    when 'moitie' then 0.5
    when 'presque_vide' then 0.25
  end;
$$;

-- ---------------------------------------------------------------------------
-- Lecture
-- ---------------------------------------------------------------------------

create view public.inventory_status
with (security_invoker = true)
as
select
  i.id,
  i.name,
  i.category,
  i.location,
  i.quantity,
  i.unit,
  i.level,
  i.expires_on,
  i.restock_threshold,
  i.restock_level,
  i.food_ref_id,
  f.code as food_code,
  f.name as food_name,
  -- « À racheter » : au seuil de rachat ou en dessous. Les niveaux se comparent dans
  -- l'ordre de l'enum (plein < moitie < presque_vide) : « plus vide » = plus grand.
  coalesce(i.quantity <= i.restock_threshold or i.level >= i.restock_level, false) as low_stock,
  i.updated_at
from public.inventory_item i
left join public.food_ref f on f.id = i.food_ref_id;

comment on view public.inventory_status is 'Inventaire avec aliment lié et indicateur low_stock (liste « À racheter »).';

revoke all on public.inventory_status from anon;

-- ---------------------------------------------------------------------------
-- Appels rejouables
-- ---------------------------------------------------------------------------

-- Clé d'idempotence d'un appel d'écriture groupé (add_items) : rejoué avec la même clé,
-- l'appel renvoie la réponse enregistrée sans rien réécrire. Les tools log_* ont leur
-- propre colonne idempotency_key (meal, workout, body_measure).
create table public.idempotent_call (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  tool text not null check (length(tool) > 0),
  response jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

comment on table public.idempotent_call is 'Réponses des appels d''écriture déjà traités, par clé d''idempotence.';

alter table public.idempotent_call enable row level security;
revoke all on public.idempotent_call from anon;
revoke truncate, references, trigger on public.idempotent_call from authenticated;

create policy "idempotent_call : lecture de ses lignes" on public.idempotent_call
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "idempotent_call : ajout de ses lignes" on public.idempotent_call
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "idempotent_call : modification de ses lignes" on public.idempotent_call
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "idempotent_call : suppression de ses lignes" on public.idempotent_call
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Écriture
-- ---------------------------------------------------------------------------

-- Nouvel article acheté. Sans quantité, il est suivi en niveau et arrive plein.
create function public.add_item(
  p_name text,
  p_category public.inventory_category,
  p_location public.inventory_location,
  p_quantity numeric default null,
  p_unit public.quantity_unit default null,
  p_food_ref_id bigint default null,
  p_expires_on date default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_id bigint;
begin
  if (p_quantity is null) <> (p_unit is null) then
    raise exception 'Quantité et unité vont ensemble' using errcode = '22023';
  end if;
  if p_quantity <= 0 then
    raise exception 'La quantité achetée doit être positive' using errcode = '22023';
  end if;

  insert into public.inventory_item (name, food_ref_id, category, location, quantity, unit, level, expires_on)
  values (
    trim(p_name), p_food_ref_id, p_category, p_location, p_quantity, p_unit,
    case when p_quantity is null then 'plein'::public.stock_level end,
    p_expires_on
  )
  returning id into v_item_id;

  insert into public.stock_movement (inventory_item_id, delta, reason)
  values (v_item_id, coalesce(p_quantity, public.stock_level_fraction('plein')), 'achat');

  return v_item_id;
end;
$$;

-- Achat d'un article déjà en stock. Suivi en niveau : un contenant plein de plus, quelle
-- que soit la quantité. Suivi en quantité : même unité obligatoire.
create function public.restock_item(
  p_item_id bigint,
  p_quantity numeric default null,
  p_unit public.quantity_unit default null,
  p_expires_on date default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.inventory_item;
  v_delta numeric;
begin
  select * into v_item from public.inventory_item where id = p_item_id for update;
  if not found then
    raise exception 'Article % introuvable', p_item_id using errcode = 'P0002';
  end if;

  if v_item.level is not null then
    v_delta := public.stock_level_fraction('plein');
    update public.inventory_item
    set level = 'plein', expires_on = least(expires_on, p_expires_on)
    where id = p_item_id;
  elsif p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantité achetée requise pour « % » (suivi en %)', v_item.name, v_item.unit
      using errcode = '22023';
  elsif p_unit is distinct from v_item.unit then
    raise exception '« % » est suivi en %, pas en %', v_item.name, v_item.unit, p_unit
      using errcode = '22023';
  else
    v_delta := p_quantity;
    -- La date à surveiller est la plus proche des deux lots.
    update public.inventory_item
    set quantity = quantity + p_quantity, expires_on = least(expires_on, p_expires_on)
    where id = p_item_id;
  end if;

  insert into public.stock_movement (inventory_item_id, delta, reason)
  values (p_item_id, v_delta, 'achat');
end;
$$;

-- Correction d'un article : seules les clés présentes dans p_changes sont modifiées
-- (null efface une date ou un seuil). Passer de la quantité au niveau, ou l'inverse,
-- efface l'ancien suivi et son seuil. Un changement de stock dans la même unité (ou
-- d'un niveau à l'autre) est tracé en stock_movement « manuel ».
create function public.update_item(p_item_id bigint, p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.inventory_item;
  v_new public.inventory_item;
  v_key text;
  v_delta numeric;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes = '{}'::jsonb then
    raise exception 'Aucune modification demandée' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key <> all (array[
      'name', 'category', 'location', 'quantity', 'unit', 'level', 'expires_on',
      'restock_threshold', 'restock_level', 'food_ref_id'
    ]) then
      raise exception 'Champ inconnu : %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_changes ? 'level' and (p_changes ? 'quantity' or p_changes ? 'unit') then
    raise exception 'Choisir entre quantité et niveau' using errcode = '22023';
  end if;
  if p_changes ? 'name' and coalesce(trim(p_changes ->> 'name'), '') = '' then
    raise exception 'Le nom ne peut pas être vide' using errcode = '22023';
  end if;

  select * into v_old from public.inventory_item where id = p_item_id for update;
  if not found then
    raise exception 'Article % introuvable', p_item_id using errcode = 'P0002';
  end if;
  v_new := v_old;

  if p_changes ? 'name' then v_new.name := trim(p_changes ->> 'name'); end if;
  if p_changes ? 'category' then
    v_new.category := (p_changes ->> 'category')::public.inventory_category;
  end if;
  if p_changes ? 'location' then
    v_new.location := (p_changes ->> 'location')::public.inventory_location;
  end if;
  if p_changes ? 'expires_on' then v_new.expires_on := (p_changes ->> 'expires_on')::date; end if;
  if p_changes ? 'food_ref_id' then v_new.food_ref_id := (p_changes ->> 'food_ref_id')::bigint; end if;

  if p_changes ? 'quantity' or p_changes ? 'unit' then
    v_new.quantity := coalesce((p_changes ->> 'quantity')::numeric, v_old.quantity);
    v_new.unit := coalesce((p_changes ->> 'unit')::public.quantity_unit, v_old.unit);
    if v_new.quantity is null or v_new.unit is null then
      raise exception 'Quantité et unité requises pour « % »', v_old.name using errcode = '22023';
    end if;
    -- Un seuil exprimé dans une autre unité (ou en niveau) n'a plus de sens.
    if v_new.unit is distinct from v_old.unit then v_new.restock_threshold := null; end if;
    v_new.level := null;
    v_new.restock_level := null;
  elsif p_changes ? 'level' then
    v_new.level := (p_changes ->> 'level')::public.stock_level;
    if v_new.level is null then
      raise exception 'Niveau requis pour « % »', v_old.name using errcode = '22023';
    end if;
    v_new.quantity := null;
    v_new.unit := null;
    v_new.restock_threshold := null;
  end if;
  if p_changes ? 'restock_threshold' then
    v_new.restock_threshold := (p_changes ->> 'restock_threshold')::numeric;
  end if;
  if p_changes ? 'restock_level' then
    v_new.restock_level := (p_changes ->> 'restock_level')::public.stock_level;
  end if;

  if v_new.restock_threshold is not null and v_new.quantity is null then
    raise exception '« % » est suivi en niveau : utiliser restock_level', v_new.name
      using errcode = '22023';
  end if;
  if v_new.restock_level is not null and v_new.level is null then
    raise exception '« % » est suivi en quantité : utiliser restock_threshold', v_new.name
      using errcode = '22023';
  end if;

  update public.inventory_item
  set
    name = v_new.name,
    food_ref_id = v_new.food_ref_id,
    category = v_new.category,
    location = v_new.location,
    quantity = v_new.quantity,
    unit = v_new.unit,
    level = v_new.level,
    expires_on = v_new.expires_on,
    restock_threshold = v_new.restock_threshold,
    restock_level = v_new.restock_level
  where id = p_item_id;

  if v_old.unit = v_new.unit then
    v_delta := v_new.quantity - v_old.quantity;
  elsif v_old.level is not null and v_new.level is not null then
    v_delta := public.stock_level_fraction(v_new.level) - public.stock_level_fraction(v_old.level);
  end if;
  if v_delta <> 0 then
    insert into public.stock_movement (inventory_item_id, delta, reason)
    values (p_item_id, v_delta, 'manuel');
  end if;
end;
$$;

-- Écritures réservées aux utilisateurs connectés (EXECUTE est accordé à public par défaut).
revoke all on function public.add_item(
  text, public.inventory_category, public.inventory_location, numeric, public.quantity_unit, bigint, date
) from public, anon;
grant execute on function public.add_item(
  text, public.inventory_category, public.inventory_location, numeric, public.quantity_unit, bigint, date
) to authenticated;
revoke all on function public.restock_item(bigint, numeric, public.quantity_unit, date) from public, anon;
grant execute on function public.restock_item(bigint, numeric, public.quantity_unit, date) to authenticated;
revoke all on function public.update_item(bigint, jsonb) from public, anon;
grant execute on function public.update_item(bigint, jsonb) to authenticated;
