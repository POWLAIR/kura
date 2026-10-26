-- Corrections des entrées de suivi : modification et suppression sous RLS (issue #22).
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

-- Code fictif : la base locale peut contenir Ciqual.
insert into public.food_ref (source, code, name, energy_kcal) values ('ciqual', 'test-corr-riz', 'Riz test', 130);

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

insert into public.workout (started_at, type, duration_min) values (now(), 'vélo', 40);
insert into public.body_measure (measured_at, weight_kg) values (now(), 70.4);
select public.log_meal(
  'Riz',
  jsonb_build_array(jsonb_build_object(
    'food_ref_id', (select id from public.food_ref where code = 'test-corr-riz'),
    'quantity', 100, 'unit', 'g'
  )),
  'corr-repas-0001'
);
insert into public.inventory_item (name, category, location, quantity, unit)
values ('Riz', 'feculents', 'placard', 900, 'g');
insert into public.stock_movement (inventory_item_id, delta, reason, meal_id)
values ((select id from public.inventory_item), -100, 'cuisine', (select id from public.meal));

-- ---------------------------------------------------------------------------
-- Isolation : B ne touche pas aux entrées de A (la RLS ignore ses lignes)
-- ---------------------------------------------------------------------------

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
update public.workout set duration_min = 1;
update public.body_measure set weight_kg = 1;
delete from public.workout;
delete from public.body_measure;
delete from public.meal;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select duration_min from public.workout), 40, 'B ne modifie pas la séance de A');
select is((select weight_kg from public.body_measure), 70.4::numeric, 'B ne modifie pas la pesée de A');
select is(
  (select count(*)::int from public.workout) + (select count(*)::int from public.body_measure)
    + (select count(*)::int from public.meal),
  3,
  'B ne supprime ni séance, ni pesée, ni repas de A'
);

-- ---------------------------------------------------------------------------
-- Suppression d'un repas par A
-- ---------------------------------------------------------------------------

delete from public.meal where idempotency_key = 'corr-repas-0001';
select is((select count(*)::int from public.meal_item), 0, 'ses aliments sont supprimés avec lui');
select is((select count(*)::int from public.stock_movement), 1, 'l''historique du stock est gardé');
select is((select meal_id from public.stock_movement), null::bigint, 'mouvement détaché du repas supprimé');

-- ---------------------------------------------------------------------------
-- Modification par A : les contraintes s'appliquent
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.workout set perceived_intensity = 6 $$,
  '23514', null, 'intensité hors bornes refusée'
);
select throws_ok(
  $$ update public.body_measure set weight_kg = 0 $$,
  '23514', null, 'poids nul refusé'
);

select * from finish();
rollback;
