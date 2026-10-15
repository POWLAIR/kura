-- Clés API du connecteur MCP (issue #5).
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@kura.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@kura.test');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

insert into public.api_key (label, key_prefix, key_hash)
values ('Claude', 'kura_AbCdEfG', repeat('a', 64));

select is(
  (select user_id from public.api_key),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'A crée sa clé, user_id rempli par auth.uid()'
);

select throws_ok(
  $$ insert into public.api_key (label, key_prefix, key_hash)
     values ('Claude', 'kura_AbCdEfG', 'kura_cle-en-clair') $$,
  '23514', null,
  'seul un hash SHA-256 hexadécimal est accepté, jamais la clé en clair'
);

select throws_ok(
  $$ insert into public.api_key (label, key_prefix, key_hash)
     values ('Doublon', 'kura_AbCdEfG', repeat('a', 64)) $$,
  '23505', null,
  'un hash est unique'
);

select throws_ok(
  $$ insert into public.api_key (user_id, label, key_prefix, key_hash)
     values ('00000000-0000-0000-0000-00000000000b', 'Pour B', 'kura_AbCdEfG', repeat('b', 64)) $$,
  '42501', null,
  'A ne peut pas créer de clé pour B'
);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');

select is((select count(*)::int from public.api_key), 0, 'B ne voit pas la clé de A');

update public.api_key set revoked_at = now();
delete from public.api_key;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is(
  (select count(*)::int from public.api_key where revoked_at is null),
  1,
  'B ne peut ni révoquer ni supprimer la clé de A'
);

update public.api_key set revoked_at = now();
select isnt((select revoked_at from public.api_key), null, 'A peut révoquer sa clé');

reset role;
set local role anon;
select throws_ok('select * from public.api_key', '42501', null, 'anon n''a aucun accès');

select * from finish();
rollback;
