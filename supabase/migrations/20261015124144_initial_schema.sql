-- Schéma initial de Kura : dix tables, RLS sur chaque table utilisateur.
-- Voir docs/conception.md, section « Modèle de données ».
--
-- Isolation entre utilisateurs : chaque table enfant référence son parent par
-- (id, user_id). Une clé étrangère n'est pas soumise à la RLS ; sans cette
-- clé composite, un utilisateur pourrait rattacher ses lignes à celles d'un autre.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (alignés sur packages/core/src/schemas.ts)
-- ---------------------------------------------------------------------------

create type public.food_source as enum ('ciqual', 'off');
create type public.inventory_category as enum ('epices', 'feculents', 'sauces', 'frais', 'fait_maison');
create type public.inventory_location as enum ('placard', 'frigo', 'congelateur');
create type public.quantity_unit as enum ('g', 'ml', 'piece');
create type public.stock_level as enum ('plein', 'moitie', 'presque_vide');
create type public.stock_movement_reason as enum ('achat', 'cuisine', 'manuel', 'perime');
create type public.recipe_origin as enum ('generee', 'manuelle');
create type public.entry_source as enum ('manuel', 'health_connect');

-- ---------------------------------------------------------------------------
-- Utilitaires
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- food_ref : référentiel nutritionnel partagé, en lecture seule
-- ---------------------------------------------------------------------------

create table public.food_ref (
  id bigint generated always as identity primary key,
  source public.food_source not null,
  code text not null,
  name text not null,
  -- Valeurs pour 100 g. null = « non renseignée » dans la source, jamais estimée.
  energy_kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  sugars_g numeric,
  fat_g numeric,
  saturated_fat_g numeric,
  fiber_g numeric,
  salt_g numeric,
  micronutrients jsonb not null default '{}'::jsonb,
  piece_weight_g numeric check (piece_weight_g > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, code)
);

comment on table public.food_ref is 'Référentiel nutritionnel (Ciqual + Open Food Facts en cache). Valeurs pour 100 g.';
comment on column public.food_ref.code is 'Code Ciqual ou EAN.';
comment on column public.food_ref.micronutrients is 'Vitamines et minéraux pour 100 g, clés stables (ex. iron_mg).';
comment on column public.food_ref.piece_weight_g is 'Poids moyen d''une pièce, pour convertir les unités hétérogènes en grammes.';

create index food_ref_name_trgm_idx on public.food_ref using gin (name extensions.gin_trgm_ops);

create trigger food_ref_set_updated_at
  before update on public.food_ref
  for each row execute function public.set_updated_at();

alter table public.food_ref enable row level security;

create policy "food_ref lisible par les utilisateurs connectés"
  on public.food_ref for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- inventory_item
-- ---------------------------------------------------------------------------

create table public.inventory_item (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(trim(name)) > 0),
  food_ref_id bigint references public.food_ref on delete set null,
  category public.inventory_category not null,
  location public.inventory_location not null,
  -- Soit une quantité chiffrée avec unité, soit un niveau approximatif.
  quantity numeric check (quantity >= 0),
  unit public.quantity_unit,
  level public.stock_level,
  expires_on date,
  -- Seuil de rachat : en quantité (même unité) ou en niveau.
  restock_threshold numeric check (restock_threshold >= 0),
  restock_level public.stock_level,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint inventory_item_amount_check check (
    (quantity is not null and unit is not null and level is null)
    or (quantity is null and unit is null and level is not null)
  ),
  constraint inventory_item_restock_check check (
    (restock_threshold is null or quantity is not null)
    and (restock_level is null or level is not null)
  )
);

create index inventory_item_user_id_idx on public.inventory_item (user_id);
create index inventory_item_food_ref_id_idx on public.inventory_item (food_ref_id);

create trigger inventory_item_set_updated_at
  before update on public.inventory_item
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipe, recipe_ingredient
-- ---------------------------------------------------------------------------

create table public.recipe (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(trim(title)) > 0),
  origin public.recipe_origin not null,
  servings smallint not null default 1 check (servings > 0),
  total_minutes integer check (total_minutes > 0),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index recipe_user_id_idx on public.recipe (user_id);

create trigger recipe_set_updated_at
  before update on public.recipe
  for each row execute function public.set_updated_at();

create table public.recipe_ingredient (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id bigint not null,
  food_ref_id bigint references public.food_ref on delete set null,
  inventory_item_id bigint,
  quantity numeric check (quantity > 0),
  unit public.quantity_unit,
  created_at timestamptz not null default now(),
  foreign key (recipe_id, user_id) references public.recipe (id, user_id) on delete cascade,
  foreign key (inventory_item_id, user_id)
    references public.inventory_item (id, user_id) on delete set null (inventory_item_id),
  constraint recipe_ingredient_amount_check check ((quantity is null) = (unit is null))
);

create index recipe_ingredient_user_id_idx on public.recipe_ingredient (user_id);
create index recipe_ingredient_recipe_id_idx on public.recipe_ingredient (recipe_id, user_id);
create index recipe_ingredient_inventory_item_id_idx on public.recipe_ingredient (inventory_item_id, user_id);
create index recipe_ingredient_food_ref_id_idx on public.recipe_ingredient (food_ref_id);

-- ---------------------------------------------------------------------------
-- meal, meal_item
-- ---------------------------------------------------------------------------

create table public.meal (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  eaten_at timestamptz not null default now(),
  recipe_id bigint,
  label text not null check (length(trim(label)) > 0),
  servings numeric check (servings > 0),
  nutrition_totals jsonb not null default '{}'::jsonb,
  -- true quand au moins un aliment n'a pas pu être converti en grammes.
  partial_values boolean not null default false,
  idempotency_key text check (length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (recipe_id, user_id)
    references public.recipe (id, user_id) on delete set null (recipe_id)
);

create index meal_user_id_eaten_at_idx on public.meal (user_id, eaten_at);
create index meal_recipe_id_idx on public.meal (recipe_id, user_id);

create table public.meal_item (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  meal_id bigint not null,
  food_ref_id bigint not null references public.food_ref on delete restrict,
  -- null quand la conversion en grammes est impossible (meal.partial_values).
  quantity_g numeric check (quantity_g > 0),
  created_at timestamptz not null default now(),
  foreign key (meal_id, user_id) references public.meal (id, user_id) on delete cascade
);

create index meal_item_user_id_idx on public.meal_item (user_id);
create index meal_item_meal_id_idx on public.meal_item (meal_id, user_id);
create index meal_item_food_ref_id_idx on public.meal_item (food_ref_id);

-- ---------------------------------------------------------------------------
-- stock_movement
-- ---------------------------------------------------------------------------

create table public.stock_movement (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  inventory_item_id bigint not null,
  delta numeric not null check (delta <> 0),
  reason public.stock_movement_reason not null,
  meal_id bigint,
  created_at timestamptz not null default now(),
  foreign key (inventory_item_id, user_id)
    references public.inventory_item (id, user_id) on delete cascade,
  foreign key (meal_id, user_id)
    references public.meal (id, user_id) on delete set null (meal_id)
);

create index stock_movement_user_id_idx on public.stock_movement (user_id);
create index stock_movement_inventory_item_id_idx on public.stock_movement (inventory_item_id, user_id);
create index stock_movement_meal_id_idx on public.stock_movement (meal_id, user_id);

-- ---------------------------------------------------------------------------
-- workout, body_measure
-- ---------------------------------------------------------------------------

create table public.workout (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  started_at timestamptz not null,
  type text not null check (length(trim(type)) > 0),
  duration_min integer not null check (duration_min > 0),
  perceived_intensity smallint check (perceived_intensity between 1 and 5),
  notes text,
  source public.entry_source not null default 'manuel',
  external_id text,
  idempotency_key text check (length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id),
  unique (user_id, idempotency_key)
);

create index workout_user_id_started_at_idx on public.workout (user_id, started_at);

create table public.body_measure (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric(5, 2) not null check (weight_kg > 0 and weight_kg < 500),
  source public.entry_source not null default 'manuel',
  external_id text,
  idempotency_key text check (length(idempotency_key) between 8 and 128),
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id),
  unique (user_id, idempotency_key)
);

create index body_measure_user_id_measured_at_idx on public.body_measure (user_id, measured_at);

-- ---------------------------------------------------------------------------
-- companion_event
-- ---------------------------------------------------------------------------

create table public.companion_event (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (length(trim(type)) > 0),
  occurred_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index companion_event_user_id_occurred_at_idx on public.companion_event (user_id, occurred_at);

-- ---------------------------------------------------------------------------
-- RLS des tables utilisateur : chacun ne voit et ne modifie que ses lignes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'inventory_item', 'stock_movement', 'recipe', 'recipe_ingredient', 'meal',
    'meal_item', 'workout', 'body_measure', 'companion_event'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- TRUNCATE n'est pas soumis à la RLS : retiré avec les autres privilèges inutiles.
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format(
      'create policy "%1$s : lecture de ses lignes" on public.%1$I for select to authenticated
         using ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "%1$s : ajout de ses lignes" on public.%1$I for insert to authenticated
         with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "%1$s : modification de ses lignes" on public.%1$I for update to authenticated
         using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format(
      'create policy "%1$s : suppression de ses lignes" on public.%1$I for delete to authenticated
         using ((select auth.uid()) = user_id)', t);
  end loop;
end;
$$;

-- food_ref : aucune écriture hors service_role.
revoke all on public.food_ref from anon;
revoke insert, update, delete, truncate, references, trigger on public.food_ref from authenticated;
