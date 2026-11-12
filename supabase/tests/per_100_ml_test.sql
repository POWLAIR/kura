-- Totaux d'un repas selon la base des valeurs de l'aliment : pour 100 g, pour 100 ml, ou
-- inconnue (issues #25 et #57). Rien n'est estimé : ce qui ne peut pas être compté rend le
-- repas « valeurs partielles ».
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test');

-- Codes fictifs : la base locale peut contenir de vrais aliments.
insert into public.food_ref (source, code, name, energy_kcal, per_100_unit) values
  ('off', 'test-ml-jus', 'Jus test', 40, 'ml'),
  ('off', 'test-ml-inconnu', 'Soda test', 42, null),
  ('ciqual', 'test-ml-riz', 'Riz test', 130, 'g');

create function pg_temp.food(code text) returns bigint language sql as $$
  select id from public.food_ref where food_ref.code = food.code;
$$;

create function pg_temp.log(key text, code text, quantity numeric, unit text) returns void
language sql as $$
  select public.log_meal(
    key,
    jsonb_build_array(jsonb_build_object(
      'name', code, 'food_ref_id', pg_temp.food(code), 'quantity', quantity, 'unit', unit)),
    key);
$$;

create function pg_temp.kcal(key text) returns numeric language sql as $$
  select (nutrition_totals -> 'values' ->> 'energy_kcal')::numeric
  from public.meal where idempotency_key = key;
$$;

create function pg_temp.partial(key text) returns boolean language sql as $$
  select partial_values from public.meal where idempotency_key = key;
$$;

-- ---------------------------------------------------------------------------
-- nutrition_amount
-- ---------------------------------------------------------------------------

select is(public.nutrition_amount('g', 2, 'piece', 120, null), 120::numeric,
  'valeurs pour 100 g : la quantité en grammes');
select is(public.nutrition_amount('ml', 250, 'ml', null, null), 250::numeric,
  'valeurs pour 100 ml, quantité en ml : comptée telle quelle, sans densité');
select is(public.nutrition_amount('ml', 200, 'g', 200, null), null::numeric,
  'valeurs pour 100 ml, quantité en g, sans densité : non comptée');
select is(public.nutrition_amount('ml', 200, 'g', 200, 1.25), 160::numeric,
  'valeurs pour 100 ml, quantité en g, avec densité : convertie en ml');
select is(public.nutrition_amount(null, 200, 'g', 200, 1), null::numeric,
  'base inconnue : jamais comptée');

-- ---------------------------------------------------------------------------
-- Repas
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text,
  true
);

select pg_temp.log('repas-jus-ml-1', 'test-ml-jus', 250, 'ml');
select is(pg_temp.kcal('repas-jus-ml-1'), 100::numeric, 'jus en ml : 250 ml × 40 kcal / 100 ml');
select is(pg_temp.partial('repas-jus-ml-1'), false, 'jus en ml : le repas n''est pas partiel');

select pg_temp.log('repas-jus-g-01', 'test-ml-jus', 200, 'g');
select is(pg_temp.kcal('repas-jus-g-01'), null::numeric,
  'jus en grammes sans densité : pas compté comme s''il était pour 100 g');
select is(pg_temp.partial('repas-jus-g-01'), true, 'jus en grammes sans densité : repas partiel');

select pg_temp.log('repas-inconnu-1', 'test-ml-inconnu', 330, 'g');
select is(pg_temp.kcal('repas-inconnu-1'), null::numeric, 'base inconnue : aucun total');
select is(pg_temp.partial('repas-inconnu-1'), true, 'base inconnue : repas partiel');

select pg_temp.log('repas-riz-g-001', 'test-ml-riz', 150, 'g');
select is(pg_temp.kcal('repas-riz-g-001'), 195::numeric, 'aliment pour 100 g : inchangé');

-- La densité donnée par l'utilisateur recalcule les deux repas : celui dit en grammes
-- devient comptable ; celui dit en ml gagne ses grammes, mais son total ne change pas.
select is(
  (select meals_updated from public.set_food_conversion(
    pg_temp.food('test-ml-jus'), '{"density_g_ml": 1.25}')),
  2,
  'densité donnée : les deux repas du jus sont recalculés'
);
select is(pg_temp.kcal('repas-jus-g-01'), 64::numeric, 'jus en grammes : 200 g / 1,25 = 160 ml × 40 / 100');
select is(pg_temp.partial('repas-jus-g-01'), false, 'jus en grammes avec densité : plus partiel');
select is(pg_temp.kcal('repas-jus-ml-1'), 100::numeric, 'jus en ml : total inchangé par la densité');

-- Densité retirée : le repas en grammes redevient partiel.
select public.set_food_conversion(pg_temp.food('test-ml-jus'), '{"density_g_ml": null}');
select is(pg_temp.partial('repas-jus-g-01'), true, 'densité retirée : repas de nouveau partiel');

select * from finish();
rollback;
