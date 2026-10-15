-- Outils d'inventaire : add_item, restock_item, update_item, inventory_status (issue #6).
begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Mouvements d'un article, du plus ancien au plus récent.
create function pg_temp.moves(item text) returns text language sql as $$
  select string_agg(m.reason || ' ' || m.delta::float8, ', ' order by m.id)
  from public.stock_movement m join public.inventory_item i on i.id = m.inventory_item_id
  where i.name = item;
$$;

create function pg_temp.item(item text) returns public.inventory_status language sql as $$
  select * from public.inventory_status where name = item;
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------------
-- add_item
-- ---------------------------------------------------------------------------

select public.add_item('Œufs', 'frais', 'frigo', 6, 'piece');
select public.add_item(' Sauce soja ', 'sauces', 'placard', p_expires_on => '2027-03-01');

select is((pg_temp.item('Œufs')).quantity, 6::numeric, 'article en quantité');
select is(pg_temp.moves('Œufs'), 'achat 6', 'un mouvement achat de la quantité');
select is((pg_temp.item('Sauce soja')).level, 'plein'::public.stock_level, 'sans quantité : suivi en niveau, plein');
select is(pg_temp.moves('Sauce soja'), 'achat 1', 'achat en niveau = un contenant plein');
select is(
  (select user_id from public.inventory_item where name = 'Œufs'),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'user_id = auth.uid()'
);
select throws_ok(
  $$ select public.add_item('Riz', 'feculents', 'placard', 0, 'g') $$,
  '22023', 'La quantité achetée doit être positive', 'quantité nulle refusée'
);
select throws_ok(
  $$ select public.add_item('Riz', 'feculents', 'placard', 500) $$,
  '22023', 'Quantité et unité vont ensemble', 'quantité sans unité refusée'
);

-- ---------------------------------------------------------------------------
-- restock_item
-- ---------------------------------------------------------------------------

select public.restock_item((pg_temp.item('Œufs')).id, 6, 'piece', '2026-11-01');
select is((pg_temp.item('Œufs')).quantity, 12::numeric, 'réassort : quantités additionnées');
select is((pg_temp.item('Œufs')).expires_on, '2026-11-01'::date, 'date ajoutée si absente');
select public.restock_item((pg_temp.item('Œufs')).id, 6, 'piece', '2026-12-01');
select is((pg_temp.item('Œufs')).expires_on, '2026-11-01'::date, 'la date la plus proche est gardée');
select is(pg_temp.moves('Œufs'), 'achat 6, achat 6, achat 6', 'un mouvement achat par réassort');

select throws_ok(
  format('select public.restock_item(%s, 200, %L)', (pg_temp.item('Œufs')).id, 'g'),
  '22023', '« Œufs » est suivi en piece, pas en g', 'unité différente refusée'
);
select throws_ok(
  format('select public.restock_item(%s)', (pg_temp.item('Œufs')).id),
  '22023', 'Quantité achetée requise pour « Œufs » (suivi en piece)', 'quantité requise'
);

select public.update_item((pg_temp.item('Sauce soja')).id, '{"level": "presque_vide"}');
select public.restock_item((pg_temp.item('Sauce soja')).id, 50, 'ml');
select is((pg_temp.item('Sauce soja')).level, 'plein'::public.stock_level, 'niveau : de nouveau plein');
select is(pg_temp.moves('Sauce soja'), 'achat 1, manuel -0.75, achat 1', 'niveau : un contenant de plus');

-- ---------------------------------------------------------------------------
-- update_item
-- ---------------------------------------------------------------------------

select public.update_item(
  (pg_temp.item('Œufs')).id,
  '{"quantity": 4, "restock_threshold": 4, "location": "placard", "expires_on": null}'
);
select is((pg_temp.item('Œufs')).quantity, 4::numeric, 'quantité corrigée');
select is((pg_temp.item('Œufs')).expires_on, null, 'null efface la date');
select is(
  pg_temp.moves('Œufs'), 'achat 6, achat 6, achat 6, manuel -14',
  'correction tracée en mouvement manuel'
);
select ok((pg_temp.item('Œufs')).low_stock, 'au seuil de rachat : à racheter');

select public.update_item((pg_temp.item('Œufs')).id, '{"level": "moitie"}');
select ok(
  (select level = 'moitie' and quantity is null and unit is null and restock_threshold is null
   from public.inventory_item where name = 'Œufs'),
  'passage en niveau : quantité, unité et seuil effacés'
);
select is(
  pg_temp.moves('Œufs'), 'achat 6, achat 6, achat 6, manuel -14',
  'changement de mode : pas de mouvement (unités incomparables)'
);

select public.update_item((pg_temp.item('Sauce soja')).id, '{"restock_level": "moitie"}');
select ok(not (pg_temp.item('Sauce soja')).low_stock, 'plein avec seuil moitié : pas à racheter');
select public.update_item((pg_temp.item('Sauce soja')).id, '{"level": "presque_vide"}');
select ok((pg_temp.item('Sauce soja')).low_stock, 'presque vide sous le seuil moitié : à racheter');

select throws_ok(
  format('select public.update_item(%s, %L)', (pg_temp.item('Œufs')).id, '{"couleur": "rouge"}'),
  '22023', 'Champ inconnu : couleur', 'champ inconnu refusé'
);
select throws_ok(
  format('select public.update_item(%s, %L)', (pg_temp.item('Œufs')).id, '{"quantity": 3}'),
  '22023', 'Quantité et unité requises pour « Œufs »', 'passage en quantité sans unité refusé'
);

-- ---------------------------------------------------------------------------
-- Isolation : B ne touche pas aux articles de A
-- ---------------------------------------------------------------------------

create temp table a_item on commit drop as select (pg_temp.item('Œufs')).id as id;
grant select on a_item to authenticated;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.inventory_status), 0, 'B ne voit pas l''inventaire de A');
select throws_ok(
  format('select public.restock_item(%s, 1, %L)', (select id from a_item), 'piece'),
  'P0002', null, 'B ne peut pas réapprovisionner un article de A'
);
select throws_ok(
  format('select public.update_item(%s, %L)', (select id from a_item), '{"name": "x"}'),
  'P0002', null, 'B ne peut pas modifier un article de A'
);

select * from finish();
rollback;
