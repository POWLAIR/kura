-- Export à sens unique de l'inventaire vers Notion (issue #29). Voir docs/notion.md.
--
-- 1. notion_export : la base Notion (source de données) de l'utilisateur, et l'état de
--    l'export. Écrite par le script notion:setup (clé de service) : l'utilisateur ne peut
--    que la lire ou la supprimer, il ne choisit pas la base où écrit le jeton du serveur.
-- 2. Un déclencheur sur inventory_item compte chaque modification (changes) ; un export
--    réussi marque comme exportées les modifications qu'il a vues (synced_changes). Un
--    compteur, pas une date : une modification validée pendant un export n'est pas perdue.
-- 3. Toutes les minutes, pg_cron appelle la fonction notion-export s'il y a des
--    modifications non exportées depuis au moins 15 secondes : les modifications
--    rapprochées (courses rangées par scan) partent en un seul export.
-- Seul l'inventaire part vers Notion, jamais les repas, séances ni pesées.

create table public.notion_export (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  -- Id de la source de données Notion (API 2025-09-03) où écrire l'inventaire.
  data_source_id text not null check (data_source_id ~ '^[0-9a-f-]{32,36}$'),
  -- Modifications de l'inventaire comptées, et comptées au dernier export réussi. Une
  -- nouvelle ligne part avec 1 à exporter : l'inventaire entier.
  changes bigint not null default 1,
  synced_changes bigint not null default 0,
  -- Dernière modification (pour attendre la fin d'une rafale) et dernier export réussi.
  changed_at timestamptz not null default now(),
  synced_at timestamptz,
  -- Code de la dernière erreur d'export (ex. notion_401), effacé par un export réussi.
  last_error text,
  -- Export en cours depuis cette date : un seul à la fois par utilisateur. Libéré à la fin
  -- de l'export, ou après 10 minutes si la fonction s'est arrêtée en route.
  export_started_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notion_export is
  'Export de l''inventaire vers une base Notion en lecture seule. À exporter quand changes > synced_changes.';

alter table public.notion_export enable row level security;
revoke all on public.notion_export from anon;
revoke truncate, references, trigger on public.notion_export from authenticated;

-- L'utilisateur lit sa ligne, ou la supprime pour arrêter l'export ; rien d'autre.
revoke insert, update on public.notion_export from authenticated;
create policy "notion_export : lecture de sa ligne" on public.notion_export
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "notion_export : suppression de sa ligne" on public.notion_export
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Modification de l'inventaire : à exporter
-- ---------------------------------------------------------------------------

-- security definer : l'utilisateur ne peut pas modifier notion_export lui-même. La fonction
-- ne fait qu'incrémenter le compteur du propriétaire de l'article modifié, que la RLS de
-- inventory_item a déjà vérifié. Sans ligne notion_export, rien ne se passe. Le verrou de
-- ligne de l'update fait passer les incréments un par un.
create function public.mark_notion_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notion_export
  set changes = changes + 1, changed_at = clock_timestamp()
  where user_id = coalesce(new.user_id, old.user_id);
  return null;
end;
$$;

create trigger inventory_item_notion_export
  after insert or update or delete on public.inventory_item
  for each row execute function public.mark_notion_export();

-- ---------------------------------------------------------------------------
-- Exports à faire
-- ---------------------------------------------------------------------------

-- Utilisateurs dont l'inventaire a changé depuis le dernier export, et plus depuis
-- p_quiet (on attend la fin d'une rafale de modifications), sans export en cours.
create function public.notion_exports_due(
  p_quiet interval default interval '15 seconds',
  p_lease interval default interval '10 minutes'
)
returns table (user_id uuid, data_source_id text, changes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.user_id, e.data_source_id, e.changes
  from public.notion_export e
  where e.changes > e.synced_changes
    and e.changed_at <= clock_timestamp() - p_quiet
    and (e.export_started_at is null or e.export_started_at < clock_timestamp() - p_lease)
  order by e.changed_at;
$$;

-- Réserve les exports à faire, en une requête : deux appels simultanés de la fonction ne
-- réservent jamais le même utilisateur (les conditions portent sur la ligne elle-même, et
-- le second update les réévalue après le premier). Renvoie les exports réservés.
create function public.claim_notion_exports(
  p_quiet interval default interval '15 seconds',
  p_lease interval default interval '10 minutes'
)
returns table (user_id uuid, data_source_id text, changes bigint)
language sql
security invoker
set search_path = ''
as $$
  update public.notion_export e
  set export_started_at = clock_timestamp()
  where e.changes > e.synced_changes
    and e.changed_at <= clock_timestamp() - p_quiet
    and (e.export_started_at is null or e.export_started_at < clock_timestamp() - p_lease)
  returning e.user_id, e.data_source_id, e.changes;
$$;

-- Appelée par pg_cron : demande l'export à la fonction notion-export s'il y en a un à faire.
-- L'adresse des fonctions et le secret partagé sont dans le coffre (vault) : tant qu'ils
-- n'y sont pas (base locale, tests), rien n'est envoyé.
create function public.request_notion_export()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.notion_exports_due()) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'kura_functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'kura_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/notion-export',
    headers := jsonb_build_object('content-type', 'application/json', 'x-kura-cron', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

-- Réservées au serveur : ni l'app ni les tools MCP ne les appellent.
revoke all on function public.notion_exports_due(interval, interval) from public, anon, authenticated;
revoke all on function public.claim_notion_exports(interval, interval) from public, anon, authenticated;
revoke all on function public.mark_notion_export() from public, anon, authenticated;
revoke all on function public.request_notion_export() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Planification
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('kura-notion-export', '* * * * *', 'select public.request_notion_export()');
