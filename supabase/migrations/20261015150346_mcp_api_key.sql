-- Clés API du connecteur MCP (phase 1, issue #5). Voir docs/mcp.md.
--
-- Seul le hash SHA-256 de la clé est stocké ; la clé en clair n'est montrée
-- qu'une fois, à la création. Le serveur MCP retrouve l'utilisateur par le hash,
-- puis exécute toutes ses requêtes avec le rôle authenticated de cet utilisateur.

create table public.api_key (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text not null check (length(trim(label)) > 0),
  -- Début de la clé (« kura_AbCdEfG »), pour la reconnaître dans les réglages.
  key_prefix text not null check (key_prefix ~ '^kura_[A-Za-z0-9_-]{7}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Une clé révoquée est refusée ; la ligne est gardée pour l'historique.
  revoked_at timestamptz
);

comment on table public.api_key is 'Clés API du connecteur MCP. Hash SHA-256 uniquement, jamais la clé en clair.';

create index api_key_user_id_idx on public.api_key (user_id);

alter table public.api_key enable row level security;
revoke all on public.api_key from anon;
revoke truncate, references, trigger on public.api_key from authenticated;

create policy "api_key : lecture de ses lignes" on public.api_key for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "api_key : ajout de ses lignes" on public.api_key for insert to authenticated
  with check ((select auth.uid()) = user_id);
-- Une session (app, tools MCP) ne peut que révoquer ses clés : ni les réactiver,
-- ni réécrire hash, préfixe ou libellé. last_used_at est tenu par le serveur MCP.
revoke update on public.api_key from authenticated;
grant update (revoked_at) on public.api_key to authenticated;
create policy "api_key : révocation de ses clés" on public.api_key for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and revoked_at is not null);
create policy "api_key : suppression de ses lignes" on public.api_key for delete to authenticated
  using ((select auth.uid()) = user_id);
