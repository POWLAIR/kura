# Serveur MCP

Le serveur MCP de Kura est une Edge Function Supabase (`supabase/functions/mcp/`) qui expose les tools de la conception (section « Serveur MCP ») à Claude. Les tools métier arrivent avec #6 (inventaire) et #8 (suivi). Ce document couvre le socle : transport, authentification et accès aux données.

## Transport

- **SDK** : le SDK MCP TypeScript officiel v2, `@modelcontextprotocol/server`, via `createMcpHandler`. C'est un handler `fetch` standard, branché sur `Deno.serve`.
- **Mode sans état** : un serveur neuf par requête HTTP, aucune session côté serveur.
- **Versions du protocole** : la 2026-07-28, et les versions 2025 (poignée de main `initialize`), servies par la même fabrique. Les tests couvrent les deux avec le client officiel.
- **Origine** : une requête qui porte un en-tête `Origin` (une page web) n'est acceptée que depuis `localhost`, pour l'inspecteur MCP. Claude appelle le serveur sans `Origin`.

## Authentification par clé API (phase 1)

- **En-tête** : la clé est envoyée dans `Authorization: Bearer kura_…`. Elle fait 43 caractères aléatoires (32 octets) après le préfixe.
- **Stockage** : la table `api_key` ne garde que le hash SHA-256 de la clé, et son début (`key_prefix`) pour la reconnaître. La clé en clair n'est affichée qu'une fois, à la création. Elle n'est jamais stockée ni loggée.
- **Refus** : une clé absente, mal formée, inconnue ou révoquée reçoit un `401` avec `WWW-Authenticate: Bearer error="invalid_token"`.
- **Suivi** : chaque requête acceptée met à jour `last_used_at`.
- **Vérification Supabase** : `verify_jwt = false` dans `supabase/config.toml`, car le serveur ne reçoit pas de JWT Supabase.
- **Phase 3** : OAuth 2.1 de Supabase Auth.

```bash
pnpm mcp:key --user <email> [--label "Claude desktop"]   # crée une clé (affichée une fois)
pnpm mcp:key --revoke kura_AbCdEfG                        # révoque par le début de la clé
```

Lance `pnpm mcp:key` toi-même : la clé apparaît dans le terminal. Les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont lues dans `.env`.

## Données : toujours sous RLS

`db.ts` ouvre une connexion Postgres (`SUPABASE_DB_URL`). Une seule requête s'exécute hors RLS : la recherche de la clé par son hash (`findCaller`), puisque l'utilisateur n'est pas encore connu.

Tout le reste passe par `asUser`. Cette fonction ouvre une transaction et s'y présente avec le rôle `authenticated` et les claims de l'utilisateur, comme le fait PostgREST pour l'app. La RLS s'applique donc telle quelle, `auth.uid()` vaut l'utilisateur de la clé, et les RPC `security invoker` (`cook_recipe`…) fonctionnent sans paramètre `user_id`.

Règle pour les tools : ils reçoivent `db` (`UserDb`) et ne touchent jamais à la connexion brute.

## Logs

Les logs ne contiennent que des événements, des identifiants et des codes d'erreur (`log.ts`), jamais de contenu ni de message d'erreur Postgres, qui peut contenir des valeurs. Événements actuels :
- `auth_refused`, avec la raison ;
- `mcp_error`, avec le code.

## En local

Il faut une clé créée pour un compte de la base locale.

```bash
pnpm db:start
pnpm exec supabase functions serve mcp
# → http://127.0.0.1:54321/functions/v1/mcp

# Inspecteur MCP en ligne de commande
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:54321/functions/v1/mcp \
  --transport http --header "Authorization: Bearer $KURA_MCP_KEY" --method tools/list
```

Pour Claude Code, `.mcp.json` déclare le serveur `kura-local`, avec la clé lue dans la variable d'environnement `KURA_MCP_KEY`.

## Tests

- **Sans base** (`pnpm check` les lance via `pnpm functions:test`) : `handler_test.ts` vérifie les refus `401` et `403`, puis la connexion et `tools/list` avec le client MCP officiel, dans les deux versions du protocole.
- **Avec base** : `db_test.ts` vérifie que `asUser` applique la RLS et que les clés révoquées sont refusées. La CI le lance contre sa base, et en local il suffit de définir `KURA_TEST_DB_URL` :

  ```bash
  KURA_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm functions:test
  ```

## Code partagé avec `packages/core`

La fonction importe `@kura/core` grâce à l'import map de `supabase/functions/mcp/deno.json`, qui pointe vers `packages/core/src`. Deno exige des imports relatifs avec extension, donc `packages/core` écrit les siens avec `.ts` (`./schemas.ts`). Deno est épinglé par pnpm (`devEngines.runtime` du `package.json`, téléchargé à l'installation) : utiliser `pnpm exec deno …`. L'edge runtime Supabase est compatible avec Deno 2.1.
