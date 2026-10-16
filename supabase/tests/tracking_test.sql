-- Suivi des repas : to_grams, meal_totals, log_meal (issue #8).
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

-- Aliments de test (codes fictifs : la base locale peut contenir Ciqual).
insert into public.food_ref (source, code, name, energy_kcal, protein_g, sugars_g, micronutrients, piece_weight_g)
values
  ('ciqual', 'test-riz', 'Riz test', 130, 2.5, null, '{"iron_mg": 0.2}', null),
  ('ciqual', 'test-oeuf', 'Oeuf test', 140, 12.5, 0.5, '{}', 50);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.food(code text) returns bigint language sql as $$
  select id from public.food_ref where food_ref.code = food.code;
$$;

-- ---------------------------------------------------------------------------
-- to_grams
-- ---------------------------------------------------------------------------

select is(public.to_grams(150, 'g', null), 150::numeric, 'grammes : tels quels');
select is(public.to_grams(2, 'piece', 50), 100::numeric, 'pièces : poids moyen de food_ref');
select is(public.to_grams(2, 'piece', null), null, 'pièces sans poids moyen : impossible');
select is(public.to_grams(250, 'ml', null), null, 'ml : impossible sans densité');

-- ---------------------------------------------------------------------------
-- log_meal
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

create temp table first_call on commit drop as
select * from public.log_meal(
  'Riz aux œufs',
  jsonb_build_array(
    jsonb_build_object('name', 'riz', 'food_ref_id', pg_temp.food('test-riz'), 'quantity', 200, 'unit', 'g'),
    jsonb_build_object('name', 'œufs', 'food_ref_id', pg_temp.food('test-oeuf'), 'quantity', 2, 'unit', 'piece')
  ),
  'repas-0001',
  '2026-10-16 12:30+02'
);

select is((select replayed from first_call), false, 'premier appel : repas créé');
select is(
  (select nutrition_totals -> 'values' from public.meal),
  '{"energy_kcal": 400.000, "protein_g": 17.500, "sugars_g": 0.500, "iron_mg": 0.400}'::jsonb,
  'totaux depuis food_ref : 200 g de riz + 2 œufs de 50 g'
);
select is(
  (select nutrition_totals -> 'incomplete' from public.meal),
  '["iron_mg", "sugars_g"]'::jsonb,
  'clés absentes pour un des aliments : total minimum, signalé'
);
select is((select partial_values from public.meal), false, 'tout converti : valeurs complètes');
select is(
  (select array_agg(quantity_g order by id) from public.meal_item),
  array[200, 100]::numeric[],
  'quantités converties en grammes'
);

create temp table replay on commit drop as
select * from public.log_meal('Riz aux œufs', '[{"name": "riz", "quantity": 1, "unit": "g"}]', 'repas-0001');
select is((select replayed from replay), true, 'même clé : rejoué');
select is((select meal_id from replay), (select meal_id from first_call), 'même repas renvoyé');
select is((select count(*)::int from public.meal), 1, 'aucun doublon');

select public.log_meal(
  'Bol',
  jsonb_build_array(
    jsonb_build_object('name', 'riz', 'food_ref_id', pg_temp.food('test-riz'), 'quantity', 100, 'unit', 'g'),
    jsonb_build_object('name', 'Sauce Kim Kee', 'food_ref_id', null, 'quantity', 15, 'unit', 'ml')
  ),
  'repas-0002'
);
select is(
  (select partial_values from public.meal where label = 'Bol'),
  true,
  'aliment sans référence : valeurs partielles'
);
select is(
  (select nutrition_totals -> 'values' ->> 'energy_kcal' from public.meal where label = 'Bol'),
  '130.000',
  'les totaux ne comptent que les aliments convertis'
);

select throws_ok(
  $$ select public.log_meal('Vide', '[]', 'repas-0003') $$,
  '22023', 'Un repas contient au moins un aliment', 'repas vide refusé'
);
select throws_ok(
  $$ select public.log_meal('X', '[{"food_ref_id": -1, "quantity": 1, "unit": "g"}]', 'repas-0004') $$,
  '22023', 'Aliment de référence inconnu', 'aliment inconnu refusé'
);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.meal), 0, 'B ne voit pas les repas de A');

select * from finish();
rollback;
