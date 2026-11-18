-- Valeurs d'une recette par portion : recipe_totals (issue #34).
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

insert into public.food_ref (source, code, name, energy_kcal, protein_g, piece_weight_g)
values
  ('ciqual', 'test-tot-riz', 'Riz test', 350, 7, null),
  ('ciqual', 'test-tot-oeuf', 'Oeuf test', 140, 12, null);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

insert into public.recipe (title, origin, servings) values ('Riz œuf', 'generee', 2);
insert into public.recipe_ingredient (recipe_id, name, food_ref_id, quantity, unit)
select r.id, x.name, (select id from public.food_ref where code = x.code), x.quantity, x.unit::public.quantity_unit
from public.recipe r,
  (values ('riz', 'test-tot-riz', 200::numeric, 'g'), ('œufs', 'test-tot-oeuf', 2, 'piece')) as x(name, code, quantity, unit);

create temp table ids as select id from public.recipe;

select is(
  (public.recipe_totals((select id from ids)) -> 'values' ->> 'energy_kcal')::numeric,
  350::numeric,
  'une portion : 100 g de riz ; œufs sans poids non comptés'
);
select is((public.recipe_totals((select id from ids)) ->> 'partial_values')::boolean, true, 'valeurs partielles');

select public.set_food_conversion((select id from public.food_ref where code = 'test-tot-oeuf'), '{"piece_weight_g": 50}');
select is(
  (public.recipe_totals((select id from ids)) -> 'values' ->> 'energy_kcal')::numeric,
  420::numeric,
  'poids de l''utilisateur : 1 œuf de 50 g en plus'
);
select is((public.recipe_totals((select id from ids)) ->> 'partial_values')::boolean, false, 'tout compté');
select is(
  (public.recipe_totals((select id from ids), 2) -> 'values' ->> 'protein_g')::numeric,
  26::numeric,
  'deux portions : 14 + 12 g'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(public.recipe_totals((select id from ids)) -> 'values', '{}'::jsonb, 'B ne voit rien de la recette de A');

select * from finish();
rollback;
