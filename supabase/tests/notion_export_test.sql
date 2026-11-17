-- Export Notion (issue #29) : droits, modifications comptées, exports à faire, réservation.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.pending(uid uuid) returns bigint language sql as $$
  select changes - synced_changes from public.notion_export where user_id = uid;
$$;

-- Lignes d'export déjà exportées, sans modification récente (écrites comme par notion:setup).
insert into public.notion_export (user_id, data_source_id, changes, synced_changes, changed_at) values
  ('00000000-0000-0000-0000-00000000000a', '0123456789abcdef0123456789abcdef', 5, 5, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000000b', 'fedcba9876543210fedcba9876543210', 3, 3, now() - interval '1 hour');

select is((select count(*)::int from public.notion_exports_due()), 0, 'rien à exporter au départ');

-- ---------------------------------------------------------------------------
-- Droits : l'utilisateur lit sa ligne ou la supprime, rien d'autre
-- ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

select is((select count(*)::int from public.notion_export), 1, 'A ne voit que sa ligne');

select throws_ok(
  $$update public.notion_export set data_source_id = '11111111111111111111111111111111'$$,
  '42501', null,
  'A ne choisit pas la base Notion où écrit le serveur'
);
select throws_ok(
  $$update public.notion_export set synced_changes = 0$$,
  '42501', null,
  'A ne fausse pas les compteurs'
);
select throws_ok(
  $$insert into public.notion_export (user_id, data_source_id)
    values ('00000000-0000-0000-0000-00000000000a', '22222222222222222222222222222222')$$,
  '42501', null,
  'A ne relie pas lui-même une base (c''est notion:setup)'
);
select throws_ok(
  $$select * from public.notion_exports_due()$$,
  '42501', null,
  'un utilisateur ne liste pas les exports à faire'
);
select throws_ok(
  $$select * from public.claim_notion_exports()$$,
  '42501', null,
  'un utilisateur ne réserve pas d''export'
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
  'deux ajouts, une modification, une suppression : quatre modifications, malgré les droits restreints');
select is(pg_temp.pending('00000000-0000-0000-0000-00000000000b'), 0::bigint,
  'l''inventaire de B n''est pas touché');

-- Pas avant la fin de la rafale de modifications.
select is((select count(*)::int from public.notion_exports_due()), 0, 'pas d''export pendant 15 s');

-- ---------------------------------------------------------------------------
-- Réservation : un seul export à la fois par utilisateur
-- ---------------------------------------------------------------------------

select is(
  (select changes from public.claim_notion_exports(interval '0 seconds')),
  9::bigint,
  'A est réservé, jusqu''à la modification 9'
);
select is(
  (select count(*)::int from public.claim_notion_exports(interval '0 seconds')),
  0,
  'un second appel ne réserve pas A pendant son export'
);
select is(
  (select count(*)::int from public.notion_exports_due(interval '0 seconds')),
  0,
  'A n''est plus dû pendant son export'
);

-- Réservation périmée (fonction arrêtée en route) : A redevient réservable.
update public.notion_export set export_started_at = now() - interval '11 minutes'
where user_id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from public.claim_notion_exports(interval '0 seconds')),
  1,
  'après 10 minutes, une réservation abandonnée est reprise'
);

-- Fin de l'export : ce qui a été vu est exporté ; une modification faite pendant reste due.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
update public.inventory_item set level = 'presque_vide' where name = 'Sel';
reset role;
update public.notion_export
set synced_changes = 9, synced_at = now(), export_started_at = null
where user_id = '00000000-0000-0000-0000-00000000000a';
select is(pg_temp.pending('00000000-0000-0000-0000-00000000000a'), 1::bigint,
  'la modification faite pendant l''export reste à exporter');

-- L'utilisateur peut arrêter l'export en supprimant sa ligne.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
delete from public.notion_export;
reset role;
select is(
  (select count(*)::int from public.notion_export where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'A arrête l''export en supprimant sa ligne'
);

select * from finish();
rollback;
