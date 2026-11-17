-- Produits Open Food Facts dans food_ref (issue #25) : colonnes, contraintes, lecture seule.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test');

-- Codes fictifs : la base locale peut contenir de vrais produits.
insert into public.food_ref (source, code, name, brand, package_quantity, package_unit, salt_g)
values ('off', 'test-off-1', 'Sauce soja', 'Kikko', 150, 'ml', 16.9);

select is(
  (select per_100_unit::text from public.food_ref where code = 'test-off-1'),
  'g',
  'les valeurs sont pour 100 g par défaut'
);

select throws_ok(
  $$insert into public.food_ref (source, code, name) values ('off', 'test-off-1', 'Doublon')$$,
  '23505', null,
  'un code-barres n''est en cache qu''une fois'
);

select lives_ok(
  $$insert into public.food_ref (source, code, name) values ('ciqual', 'test-off-1', 'Même code, autre source')$$,
  'le même code peut exister dans une autre source'
);

select throws_ok(
  $$insert into public.food_ref (source, code, name, package_quantity) values ('off', 'test-off-2', 'Sans unité', 400)$$,
  '23514', null,
  'une contenance sans unité est refusée'
);

select throws_ok(
  $$insert into public.food_ref (source, code, name, package_quantity, package_unit) values ('off', 'test-off-3', 'En pièces', 6, 'piece')$$,
  '23514', null,
  'la contenance est en g ou en ml'
);

select throws_ok(
  $$insert into public.food_ref (source, code, name, per_100_unit) values ('off', 'test-off-4', 'Base en pièces', 'piece')$$,
  '23514', null,
  'les valeurs sont pour 100 g ou 100 ml'
);

-- Un utilisateur connecté lit le produit, mais n'écrit jamais dans le référentiel.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text,
  true
);

select is(
  (select brand || ' ' || package_quantity || ' ' || package_unit from public.food_ref
   where source = 'off' and code = 'test-off-1'),
  'Kikko 150 ml',
  'un utilisateur connecté lit le produit en cache'
);

select throws_ok(
  $$insert into public.food_ref (source, code, name) values ('off', 'test-off-5', 'Écrit par un utilisateur')$$,
  '42501', null,
  'un utilisateur connecté ne peut pas ajouter de produit'
);

select throws_ok(
  $$update public.food_ref set name = 'Modifié' where code = 'test-off-1'$$,
  '42501', null,
  'un utilisateur connecté ne peut pas modifier un produit'
);

select * from finish();
rollback;
