-- « J'ai cuisiné » : cook_recipe et delete_meal (issue #33).
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

-- Aliments de test (codes fictifs : la base locale peut contenir Ciqual).
insert into public.food_ref (source, code, name, energy_kcal, piece_weight_g)
values
  ('ciqual', 'test-cook-riz', 'Riz test', 350, null),
  ('ciqual', 'test-cook-oeuf', 'Oeuf test', 140, null),
  ('ciqual', 'test-cook-sauce', 'Sauce test', 50, null),
  ('ciqual', 'test-cook-oignon', 'Oignon test', 40, 100);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.food(code text) returns bigint language sql as $$
  select id from public.food_ref where food_ref.code = food.code;
$$;

create function pg_temp.item(item_name text) returns public.inventory_item language sql as $$
  select * from public.inventory_item where name = item_name;
$$;

create function pg_temp.meal(key text) returns public.meal language sql as $$
  select * from public.meal where idempotency_key = key;
$$;

-- Statuts de stock renvoyés par cook_recipe, ingrédient par ingrédient.
create function pg_temp.statuses(stock jsonb) returns text[] language sql as $$
  select array_agg((s.value ->> 'ingredient') || ':' || (s.value ->> 'status') order by s.ordinality)
  from jsonb_array_elements(stock) with ordinality as s(value, ordinality);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- Stock : riz en g, œufs en pièces (6), sauce suivie en niveau, oignons en g (poids par
-- pièce connu dans food_ref), lait en ml sans densité.
insert into public.inventory_item (name, food_ref_id, category, location, quantity, unit, level)
values
  ('Riz', pg_temp.food('test-cook-riz'), 'feculents', 'placard', 500, 'g', null),
  ('Oeufs', pg_temp.food('test-cook-oeuf'), 'frais', 'frigo', 6, 'piece', null),
  ('Sauce', pg_temp.food('test-cook-sauce'), 'sauces', 'placard', null, null, 'plein'),
  ('Oignons', pg_temp.food('test-cook-oignon'), 'frais', 'placard', 150, 'g', null),
  ('Lait', null, 'frais', 'frigo', 1000, 'ml', null);

-- Recette pour 2 portions.
insert into public.recipe (title, origin, servings) values ('Riz sauté', 'manuelle', 2);
insert into public.recipe_ingredient (recipe_id, name, food_ref_id, inventory_item_id, quantity, unit, position)
select r.id, x.name, pg_temp.food(x.code), (pg_temp.item(x.item)).id, x.quantity, x.unit::public.quantity_unit, x.position
from public.recipe r,
  (values
    ('riz', 'test-cook-riz', 'Riz', 200::numeric, 'g', 1),
    ('œufs', 'test-cook-oeuf', 'Oeufs', 2, 'piece', 2),
    ('sauce', 'test-cook-sauce', 'Sauce', 30, 'ml', 3),
    ('oignon', 'test-cook-oignon', 'Oignons', 1, 'piece', 4),
    ('lait', null, 'Lait', 100, 'g', 5),
    ('sel', null, null, null, null, 6)
  ) as x(name, code, item, quantity, unit, position)
where r.title = 'Riz sauté';

create temp table ids as select id as recipe_id from public.recipe where title = 'Riz sauté';

create temp table cooked as
select * from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 1, 'cook-0001');

select is((select replayed from cooked), false, 'premier appel : repas créé');
select is(
  pg_temp.statuses((select stock from cooked)),
  array['riz:decremented', 'œufs:decremented', 'sauce:level', 'oignon:decremented', 'lait:no_conversion'],
  'stock : niveau et conversion impossible non décrémentés, ingrédients hors stock absents'
);

-- Toute la recette cuisinée (2 portions) est décomptée du stock.
select is((pg_temp.item('Riz')).quantity, 300::numeric, 'riz : 500 - 200 g');
select is((pg_temp.item('Oeufs')).quantity, 4::numeric, 'œufs : 6 - 2');
select is((pg_temp.item('Sauce')).level, 'plein'::public.stock_level, 'sauce en niveau : inchangée (D3)');
select is((pg_temp.item('Oignons')).quantity, 50::numeric, 'oignon : 1 pièce = 100 g, convertie dans l''unité de l''article');
select is((pg_temp.item('Lait')).quantity, 1000::numeric, 'lait : g vers ml sans densité, inchangé');
select is(
  (select array_agg(delta order by delta) from public.stock_movement where meal_id = (select meal_id from cooked) and reason = 'cuisine'),
  array[-200, -100, -2]::numeric[],
  'un mouvement « cuisine » par article décrémenté, lié au repas'
);

-- Le repas compte la portion mangée (1 sur 2).
select is((pg_temp.meal('cook-0001')).label, 'Riz sauté', 'libellé : titre de la recette');
select is((pg_temp.meal('cook-0001')).servings, 1::numeric, 'portions mangées');
select is(
  (select array_agg(quantity order by id) from public.meal_item where meal_id = (select meal_id from cooked) and quantity is not null),
  array[100, 1, 15, 0.5, 50]::numeric[],
  'aliments du repas : moitié de la recette'
);
select is((pg_temp.meal('cook-0001')).partial_values, true, 'sel sans quantité, sauce en ml sans densité : valeurs partielles');
select is(
  ((pg_temp.meal('cook-0001')).nutrition_totals -> 'values' ->> 'energy_kcal')::numeric,
  (350 + 20)::numeric,
  'totaux depuis food_ref : 100 g de riz et 50 g d''oignon ; œuf sans poids et sauce sans densité non comptés'
);

-- Compagnon : repas cuisiné et première fois, avec des ids seulement.
select is(
  (select array_agg(type order by id) from public.companion_event),
  array['meal_cooked', 'recipe_first_cooked'],
  'événements du compagnon'
);
select is(
  (select data from public.companion_event where type = 'meal_cooked'),
  jsonb_build_object('recipe_id', (select id from public.recipe where title = 'Riz sauté'), 'meal_id', (select meal_id from cooked)),
  'données de l''événement : des ids'
);

-- Rejoué : rien n'est décrémenté deux fois.
select is(
  (select row(meal_id, replayed, stock)::text from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 1, 'cook-0001')),
  row((select meal_id from cooked), true, '[]'::jsonb)::text,
  'rejoué : même repas, rien de réécrit'
);
select is((pg_temp.item('Riz')).quantity, 300::numeric, 'rejoué : riz inchangé');
select is((select count(*)::int from public.meal where recipe_id is not null), 1, 'rejoué : un seul repas');

-- Deuxième cuisson, partielle : stock insuffisant, pas de « première fois ».
update public.inventory_item set quantity = 150 where name = 'Riz';
select is(
  pg_temp.statuses((select stock from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 2, 'cook-0002', 2))),
  array['riz:insufficient', 'œufs:decremented', 'sauce:level', 'oignon:insufficient', 'lait:no_conversion'],
  'stock arrivé à 0 : insufficient'
);
select is((pg_temp.item('Riz')).quantity, 0::numeric, 'jamais sous 0');
select is(
  pg_temp.statuses((select stock from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 1, 'cook-0005'))),
  array['riz:empty', 'œufs:decremented', 'sauce:level', 'oignon:empty', 'lait:no_conversion'],
  'déjà à 0 : empty, aucun mouvement'
);
select is((select count(*)::int from public.companion_event where type = 'recipe_first_cooked'), 1, 'première fois : une seule');

-- Saisies refusées : la transaction ne laisse rien.
select throws_ok(
  $$ select * from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 3, 'cook-0003', 2) $$,
  '22023', null, 'plus de portions mangées que cuisinées'
);
select throws_ok(
  $$ select * from public.cook_recipe(999999999, 1, 'cook-0004') $$,
  'P0002', null, 'recette inconnue'
);
select public.log_meal('Pomme', '[{"name": "pomme", "quantity": 1, "unit": "piece"}]', 'meal-0001');
select throws_ok(
  $$ select * from public.cook_recipe((select id from public.recipe where title = 'Riz sauté'), 1, 'meal-0001') $$,
  '22023', null, 'clé déjà prise par un autre repas : refus'
);
select is((select count(*)::int from public.meal where idempotency_key in ('cook-0003', 'cook-0004')), 0, 'refus : aucun repas');

-- ---------------------------------------------------------------------------
-- delete_meal : remise en stock (D4)
-- ---------------------------------------------------------------------------

update public.inventory_item set quantity = 1000 where name = 'Riz';
select is(
  (select jsonb_array_length(public.delete_meal((pg_temp.meal('cook-0001')).id) -> 'restocked')),
  3,
  'trois articles remis en stock'
);
select is((pg_temp.item('Riz')).quantity, 1200::numeric, 'riz : +200 g remis');
select is((pg_temp.item('Oignons')).quantity, 100::numeric, 'oignon : +100 g remis');

-- Article passé en niveau depuis la cuisson : rien n'est remis, c'est signalé.
select public.update_item((pg_temp.item('Oeufs')).id, '{"level": "moitie"}');
select is(
  (public.delete_meal((pg_temp.meal('cook-0002')).id) -> 'not_restocked' -> 0 ->> 'reason'),
  'level',
  'article passé en niveau : non remis'
);

-- ---------------------------------------------------------------------------
-- RLS : un autre utilisateur ne cuisine pas ma recette
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  format('select * from public.cook_recipe(%s, 1, %L)', (select recipe_id from ids), 'cook-b-0001'),
  'P0002', null, 'B : la recette de A est introuvable'
);
select is((select count(*)::int from public.recipe), 0, 'B ne voit pas la recette de A');

reset role;
select is(
  (select quantity from public.inventory_item where name = 'Riz'),
  1350::numeric,
  'stock de A intact (1000 + 200 + 150 remis)'
);

select * from finish();
rollback;
