-- Export Notion (issue #29) : RLS, modifications comptées, exports à faire.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.pending(uid uuid) returns bigint language sql as $$
  select changes - synced_changes from public.notion_export where user_id = uid;
$$;

-- Lignes d'export déjà exportées, sans modification récente.
insert into public.notion_export (user_id, data_source_id, changes, synced_changes, changed_at) values
  ('00000000-0000-0000-0000-00000000000a', '0123456789abcdef0123456789abcdef', 5, 5, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000000b', 'fedcba9876543210fedcba9876543210', 3, 3, now() - interval '1 hour');

select is((select count(*)::int from public.notion_exports_due()), 0, 'rien à exporter au départ');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select is((select count(*)::int from public.notion_export), 1, 'A ne voit que sa ligne');

update public.notion_export set data_source_id = '11111111111111111111111111111111'
where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(
  (select data_source_id from public.notion_export),
  'fedcba9876543210fedcba9876543210',
  'A ne peut pas modifier la ligne de B'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.notion_export (user_id, data_source_id)
    values ('00000000-0000-0000-0000-00000000000a', '22222222222222222222222222222222')$$,
  '23505', null,
  'une seule ligne par utilisateur'
);

select throws_ok(
  $$select * from public.notion_exports_due()$$,
  '42501', null,
  'un utilisateur ne liste pas les exports à faire'
);
select throws_ok(
  $$select public.request_notion_export()$$,
  '42501', null,
  'un utilisateur ne déclenche pas l''export'
);

-- ---------------------------------------------------------------------------
-- Chaque modification de l'inventaire est comptée, pour son propriétaire seulement
-- ---------------------------------------------------------------------------

insert into public.inventory_item (name, category, location, level)
values ('Sel', 'epices', 'placard', 'plein'), ('Poivre', 'epices', 'placard', 'plein');
update public.inventory_item set level = 'moitie' where name = 'Sel';
delete from public.inventory_item where name = 'Poivre';

reset role;
select is(pg_temp.pending('00000000-0000-0000-0000-00000000000a'), 4::bigint,
  'deux ajouts, une modification, une suppression : quatre modifications à exporter');
select is(pg_temp.pending('00000000-0000-0000-0000-00000000000b'), 0::bigint,
  'l''inventaire de B n''est pas touché');

-- Pas avant la fin de la rafale de modifications.
select is((select count(*)::int from public.notion_exports_due()), 0, 'pas d''export pendant 15 s');
select is(
  (select changes from public.notion_exports_due(interval '0 seconds')),
  9::bigint,
  'puis A est à exporter, jusqu''à la modification 9'
);

-- Un export marque ce qu'il a vu ; une modification arrivée pendant l'export reste à faire.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update public.inventory_item set level = 'presque_vide' where name = 'Sel';
reset role;
update public.notion_export set synced_changes = 9, synced_at = now()
where user_id = '00000000-0000-0000-0000-00000000000a';
select is(pg_temp.pending('00000000-0000-0000-0000-00000000000a'), 1::bigint,
  'la modification faite pendant l''export reste à exporter');

-- Une nouvelle ligne demande l'export de tout l'inventaire.
delete from public.notion_export where user_id = '00000000-0000-0000-0000-00000000000b';
insert into public.notion_export (user_id, data_source_id, changed_at)
values ('00000000-0000-0000-0000-00000000000b', 'fedcba9876543210fedcba9876543210', now() - interval '1 minute');
select ok(
  '00000000-0000-0000-0000-00000000000b'::uuid in (select user_id from public.notion_exports_due()),
  'une base Notion nouvellement reliée reçoit tout l''inventaire'
);

select * from finish();
rollback;
