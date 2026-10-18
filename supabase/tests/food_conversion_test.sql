-- Poids par pièce et densités de l'utilisateur : set_food_conversion, recalcul (issue #20).
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

-- Aliments de test (codes fictifs : la base locale peut contenir Ciqual).
insert into public.food_ref (source, code, name, energy_kcal, piece_weight_g)
values
  ('ciqual', 'test-conv-oeuf', 'Oeuf test', 140, null),
  ('ciqual', 'test-conv-sauce', 'Sauce test', 50, null),
  ('ciqual', 'test-conv-kiwi', 'Kiwi test', 60, 75);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.food(code text) returns bigint language sql as $$
  select id from public.food_ref where food_ref.code = food.code;
$$;

-- Résultat de set_food_conversion en texte : (poids, densité, repas recalculés).
create function pg_temp.set_conv(code text, changes jsonb) returns text language sql as $$
  select row(piece_weight_g, density_g_ml, meals_updated)::text
  from public.set_food_conversion(pg_temp.food(code), changes);
$$;

create function pg_temp.grams(code text) returns numeric[] language sql as $$
  select array_agg(quantity_g order by id) from public.meal_item
  where food_ref_id = pg_temp.food(code);
$$;

create function pg_temp.meal(key text) returns public.meal language sql as $$
  select * from public.meal where idempotency_key = key;
$$;

select is(public.to_grams(15, 'ml', null, 1.2), 18.0, 'ml : densité');

-- ---------------------------------------------------------------------------
-- Conversions et recalcul
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select public.log_meal(
  'Oeufs sauce',
  jsonb_build_array(
    jsonb_build_object('name', 'œufs', 'food_ref_id', pg_temp.food('test-conv-oeuf'), 'quantity', 2, 'unit', 'piece'),
    jsonb_build_object('name', 'sauce', 'food_ref_id', pg_temp.food('test-conv-sauce'), 'quantity', 15, 'unit', 'ml')
  ),
  'conv-0001'
);
select is((pg_temp.meal('conv-0001')).partial_values, true, 'sans poids ni densité : partiel');

select is(pg_temp.set_conv('test-conv-oeuf', '{"piece_weight_g": 60}'), '(60,,1)', 'poids enregistré, un repas recalculé');
select is(pg_temp.grams('test-conv-oeuf'), array[120]::numeric[], 'repas passé : 2 œufs de 60 g');
select is((pg_temp.meal('conv-0001')).partial_values, true, 'sauce encore sans densité : toujours partiel');

select is(pg_temp.set_conv('test-conv-sauce', '{"density_g_ml": 1.2}'), '(,1.2,1)', 'densité enregistrée');
select is((pg_temp.meal('conv-0001')).partial_values, false, 'tout converti : valeurs complètes');
select is(
  ((pg_temp.meal('conv-0001')).nutrition_totals -> 'values' ->> 'energy_kcal')::numeric,
  177::numeric,
  'totaux recalculés : 120 g d''œuf (168) + 18 g de sauce (9)'
);

select public.log_meal(
  'Oeuf',
  jsonb_build_array(jsonb_build_object('food_ref_id', pg_temp.food('test-conv-oeuf'), 'quantity', 1, 'unit', 'piece')),
  'conv-0002'
);
select is(pg_temp.grams('test-conv-oeuf'), array[120, 60]::numeric[], 'nouveau repas : converti à la saisie');

select is(pg_temp.set_conv('test-conv-oeuf', '{"density_g_ml": 1.03}'), '(60,1.03,0)', 'clé absente : valeur gardée ; rien à recalculer');
select is(pg_temp.set_conv('test-conv-oeuf', '{"piece_weight_g": 50}'), '(50,1.03,2)', 'poids corrigé : tous les repas recalculés');
select is(pg_temp.grams('test-conv-oeuf'), array[100, 50]::numeric[], 'quantités recalculées depuis la quantité dite');

-- Poids de food_ref : celui de l'utilisateur prime, et le remplace s'il est retiré.
select public.log_meal(
  'Kiwi',
  jsonb_build_array(jsonb_build_object('food_ref_id', pg_temp.food('test-conv-kiwi'), 'quantity', 1, 'unit', 'piece')),
  'conv-0003'
);
select is(pg_temp.grams('test-conv-kiwi'), array[75]::numeric[], 'poids moyen de food_ref par défaut');
select is(pg_temp.set_conv('test-conv-kiwi', '{"piece_weight_g": 80}'), '(80,,1)', 'poids de l''utilisateur prioritaire');
select is(pg_temp.set_conv('test-conv-kiwi', '{"piece_weight_g": null}'), '(,,1)', 'poids retiré');
select is(pg_temp.grams('test-conv-kiwi'), array[75]::numeric[], 'retour au poids de food_ref');
select is(
  (select count(*)::int from public.food_conversion where food_ref_id = pg_temp.food('test-conv-kiwi')),
  0,
  'plus aucune valeur : ligne supprimée'
);

select throws_ok(
  $$ select public.set_food_conversion(pg_temp.food('test-conv-oeuf'), '{}') $$,
  '22023', 'Aucune modification demandée', 'modification vide refusée'
);
select throws_ok(
  $$ select public.set_food_conversion(pg_temp.food('test-conv-oeuf'), '{"poids": 60}') $$,
  '22023', 'Champ inconnu : poids', 'champ inconnu refusé'
);
select throws_ok(
  $$ select public.set_food_conversion(-1, '{"piece_weight_g": 60}') $$,
  '22023', 'Aliment de référence inconnu', 'aliment inconnu refusé'
);
select throws_ok(
  $$ select public.set_food_conversion(pg_temp.food('test-conv-oeuf'), '{"piece_weight_g": 0}') $$,
  '23514', null, 'poids nul refusé'
);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.food_conversion), 0, 'B ne voit pas les valeurs de A');

select public.log_meal(
  'Oeufs',
  jsonb_build_array(jsonb_build_object('food_ref_id', pg_temp.food('test-conv-oeuf'), 'quantity', 2, 'unit', 'piece')),
  'conv-0001'
);
select is(pg_temp.grams('test-conv-oeuf'), array[null]::numeric[], 'le poids de A ne vaut pas pour B');
select is(pg_temp.set_conv('test-conv-oeuf', '{"piece_weight_g": 70}'), '(70,,1)', 'B ne recalcule que son repas');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  pg_temp.set_conv('test-conv-oeuf', '{"piece_weight_g": null, "density_g_ml": null}'),
  '(,,2)',
  'A retire ses valeurs : ses deux repas recalculés, pas celui de B'
);
select is((pg_temp.meal('conv-0001')).partial_values, true, 'sans poids : de nouveau partiel');

select * from finish();
rollback;
