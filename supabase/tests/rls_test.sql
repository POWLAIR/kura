-- RLS et isolation entre utilisateurs (issue #1).
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname = any (array[
     'food_ref', 'inventory_item', 'stock_movement', 'recipe', 'recipe_ingredient',
     'meal', 'meal_item', 'workout', 'body_measure', 'companion_event'])),
  10,
  'les dix tables existent'
);

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'RLS activée sur toutes les tables de public'
);

select is(
  (select array_agg(table_name::text order by table_name) from information_schema.columns
   where table_schema = 'public' and column_name = 'user_id' and is_nullable = 'YES'),
  null,
  'user_id jamais nullable'
);

-- ---------------------------------------------------------------------------
-- Données : deux utilisateurs, A et B
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

insert into public.food_ref (source, code, name, energy_kcal)
values ('ciqual', '9100', 'Riz blanc, cuit', 130);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

insert into public.inventory_item (name, food_ref_id, category, location, quantity, unit)
values ('Riz', (select id from public.food_ref where code = '9100'), 'feculents', 'placard', 1000, 'g');
insert into public.recipe (title, origin) values ('Riz teriyaki', 'manuelle');
insert into public.meal (label, idempotency_key) values ('Riz teriyaki', 'cle-repas-0001');
insert into public.meal_item (meal_id, food_ref_id, quantity_g)
values ((select id from public.meal), (select id from public.food_ref), 150);
insert into public.stock_movement (inventory_item_id, delta, reason)
values ((select id from public.inventory_item), -150, 'cuisine');
insert into public.recipe_ingredient (recipe_id, inventory_item_id, quantity, unit)
values ((select id from public.recipe), (select id from public.inventory_item), 150, 'g');
insert into public.workout (started_at, type, duration_min) values (now(), 'vélo', 40);
insert into public.body_measure (measured_at, weight_kg) values (now(), 70.5);
insert into public.companion_event (type) values ('repas_cuisine');

select is((select count(*)::int from public.inventory_item), 1, 'A voit son inventaire');
select is(
  (select user_id from public.inventory_item),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'user_id rempli par défaut avec auth.uid()'
);

-- Ids de A, mémorisés pour les tentatives de B.
create temp table a_ids on commit drop as select
  (select id from public.inventory_item) as item_id,
  (select id from public.recipe) as recipe_id,
  (select id from public.meal) as meal_id;
grant select on a_ids to authenticated;

-- ---------------------------------------------------------------------------
-- B ne voit rien de A
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.inventory_item), 0, 'B ne voit pas inventory_item de A');
select is((select count(*)::int from public.stock_movement), 0, 'B ne voit pas stock_movement de A');
select is((select count(*)::int from public.recipe), 0, 'B ne voit pas recipe de A');
select is((select count(*)::int from public.recipe_ingredient), 0, 'B ne voit pas recipe_ingredient de A');
select is((select count(*)::int from public.meal), 0, 'B ne voit pas meal de A');
select is((select count(*)::int from public.meal_item), 0, 'B ne voit pas meal_item de A');
select is((select count(*)::int from public.workout), 0, 'B ne voit pas workout de A');
select is((select count(*)::int from public.body_measure), 0, 'B ne voit pas body_measure de A');
select is((select count(*)::int from public.companion_event), 0, 'B ne voit pas companion_event de A');

-- ---------------------------------------------------------------------------
-- B ne peut ni écrire chez A, ni modifier ou supprimer les lignes de A
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.workout (user_id, started_at, type, duration_min)
    values ('00000000-0000-0000-0000-00000000000a', now(), 'course', 30)$$,
  '42501', null,
  'B ne peut pas insérer au nom de A'
);

update public.inventory_item set quantity = 0 where id = (select item_id from a_ids);
delete from public.meal where id = (select meal_id from a_ids);

select throws_ok(
  $$truncate public.workout$$,
  '42501', null,
  'TRUNCATE interdit (il contournerait la RLS)'
);

-- Clés étrangères composites : impossible de rattacher ses lignes à celles de A.
select throws_ok(
  $$insert into public.stock_movement (inventory_item_id, delta, reason)
    values ((select item_id from a_ids), -1, 'manuel')$$,
  '23503', null,
  'B ne peut pas créer un mouvement sur un article de A'
);
select throws_ok(
  $$insert into public.meal_item (meal_id, food_ref_id, quantity_g)
    values ((select meal_id from a_ids), (select id from public.food_ref), 10)$$,
  '23503', null,
  'B ne peut pas ajouter un aliment au repas de A'
);
select throws_ok(
  $$insert into public.recipe_ingredient (recipe_id, quantity, unit)
    values ((select recipe_id from a_ids), 1, 'g')$$,
  '23503', null,
  'B ne peut pas ajouter un ingrédient à la recette de A'
);

-- ---------------------------------------------------------------------------
-- food_ref : lecture seule pour les utilisateurs
-- ---------------------------------------------------------------------------

select is((select count(*)::int from public.food_ref), 1, 'food_ref lisible par B');
select throws_ok(
  $$insert into public.food_ref (source, code, name) values ('off', '3017620422003', 'Pâte à tartiner')$$,
  '42501', null,
  'food_ref non modifiable par un utilisateur'
);
select throws_ok(
  $$update public.food_ref set name = 'x'$$,
  '42501', null,
  'food_ref non modifiable (update)'
);

-- ---------------------------------------------------------------------------
-- A retrouve ses données intactes ; contraintes d'idempotence
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select is((select quantity from public.inventory_item), 1000::numeric, 'la mise à jour de B n''a rien changé');
select is((select count(*)::int from public.meal), 1, 'la suppression de B n''a rien changé');

select throws_ok(
  $$insert into public.meal (label, idempotency_key) values ('doublon', 'cle-repas-0001')$$,
  '23505', null,
  'clé d''idempotence unique par utilisateur'
);

insert into public.workout (started_at, type, duration_min, source, external_id)
values (now(), 'marche', 20, 'health_connect', 'hc-123');
select throws_ok(
  $$insert into public.workout (started_at, type, duration_min, source, external_id)
    values (now(), 'marche', 20, 'health_connect', 'hc-123')$$,
  '23505', null,
  'import Health Connect idempotent'
);

select throws_ok(
  $$insert into public.inventory_item (name, category, location, quantity, unit, level)
    values ('Sauce soja', 'sauces', 'placard', 500, 'ml', 'plein')$$,
  '23514', null,
  'quantité et niveau sont exclusifs'
);
select lives_ok(
  $$insert into public.inventory_item (name, category, location, level, restock_level)
    values ('Sauce soja', 'sauces', 'placard', 'plein', 'presque_vide')$$,
  'article au niveau approximatif avec seuil en niveau'
);

-- ---------------------------------------------------------------------------
-- anon n'a aucun accès
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select throws_ok($$select * from public.inventory_item$$, '42501', null, 'anon ne lit pas inventory_item');
select throws_ok($$select * from public.food_ref$$, '42501', null, 'anon ne lit pas food_ref');

select * from finish();
rollback;
