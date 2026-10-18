# Serveur MCP

Le serveur MCP de Kura est une Edge Function Supabase (`supabase/functions/mcp/`) qui expose les tools de la conception (section « Serveur MCP ») à Claude. Les tools d'inventaire et de suivi sont décrits plus bas. À la connexion, le serveur envoie aussi à Claude des instructions communes (`server.ts`) : ne jamais estimer de valeur nutritionnelle, relancer sur les ambiguïtés, une clé d'idempotence par enregistrement, rester neutre.

## Transport

- **SDK** : le SDK MCP TypeScript officiel v2, `@modelcontextprotocol/server`, via `createMcpHandler`. C'est un handler `fetch` standard, branché sur `Deno.serve`.
- **Mode sans état** : un serveur neuf par requête HTTP, aucune session côté serveur.
- **Versions du protocole** : la 2026-07-28, et les versions 2025 (poignée de main `initialize`), servies par la même fabrique. Les tests couvrent les deux avec le client officiel.
- **Origine** : une requête qui porte un en-tête `Origin` (une page web) n'est acceptée que depuis `localhost`, pour l'inspecteur MCP. Claude appelle le serveur sans `Origin`.

## Authentification par clé API (phase 1)

- **En-tête** : la clé est envoyée dans `Authorization: Bearer kura_…` (Claude Code), ou dans n'importe quel autre en-tête, la clé seule ou précédée de `Bearer`. C'est le cas du connecteur claude.ai, qui n'offre qu'une liste fixe d'en-têtes `X-…`. Le nom de l'en-tête ne compte pas : seule une valeur au format d'une clé est retenue, puis vérifiée par son hash (`apiKeyFromHeaders`).
- **Format** : la clé fait 43 caractères aléatoires (32 octets) après le préfixe `kura_`. Ce format est vérifié quel que soit l'en-tête.
- **Stockage** : la table `api_key` ne garde que le hash SHA-256 de la clé, et son début (`key_prefix`) pour la reconnaître. La clé en clair n'est affichée qu'une fois, à la création. Elle n'est jamais stockée ni loggée.
- **Droits d'une session** : une session (app ou tools MCP) peut créer, lire, révoquer et supprimer ses clés. Elle ne peut ni réactiver une clé révoquée, ni réécrire son hash.
- **Refus** : une clé absente, mal formée, inconnue ou révoquée reçoit un `401` avec `WWW-Authenticate: Bearer error="invalid_token"`. Si la base ne répond pas, le serveur renvoie un `503` : le client réessaie au lieu de croire sa clé révoquée.
- **Suivi** : chaque requête acceptée met à jour `last_used_at`.
- **Vérification Supabase** : `verify_jwt = false` dans `supabase/config.toml`, car le serveur ne reçoit pas de JWT Supabase.
- **Phase 3** : OAuth 2.1 de Supabase Auth.

```bash
pnpm mcp:key --user <email> [--label "Claude desktop"]   # crée une clé (affichée une fois)
pnpm mcp:key --revoke kura_AbCdEfG                        # révoque, par les 12 premiers caractères
```

Lance `pnpm mcp:key` toi-même : la clé apparaît dans le terminal. Les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont lues dans `.env`.

## Données : toujours sous RLS

`db.ts` ouvre une connexion Postgres (`SUPABASE_DB_URL`). Une seule requête s'exécute hors RLS : la recherche de la clé par son hash (`findCaller`), puisque l'utilisateur n'est pas encore connu.

Tout le reste passe par `asUser`. Cette fonction ouvre une transaction et s'y présente avec le rôle `authenticated` et les claims de l'utilisateur, comme le fait PostgREST pour l'app. La RLS s'applique donc telle quelle, `auth.uid()` vaut l'utilisateur de la clé, et les RPC `security invoker` (`cook_recipe`…) fonctionnent sans paramètre `user_id`.

Règle pour les tools : ils reçoivent `db` (`UserDb`) et ne touchent jamais à la connexion brute.

## Tools d'inventaire

| Tool | Rôle |
|---|---|
| `get_inventory` | Liste le stock, filtrable par catégorie, emplacement ou stock bas |
| `add_items` | Enregistre des courses : réapprovisionne un article existant ou en crée un |
| `update_item` | Corrige quantité, niveau, date, emplacement, seuil de rachat, nom, aliment |
| `get_shopping_list` | Articles au seuil de rachat ou en dessous |

**Partage des rôles :**
- **Entrées** : les schémas Zod sont dans `packages/core/src/inventory.ts`, partagés avec l'app.
- **Décisions** : la règle qui choisit entre réapprovisionner, créer ou répondre « ambigu » est `planPurchase`, une fonction pure (`packages/core/src/purchase.ts`).
- **Écritures** : elles passent par les fonctions SQL `add_item`, `restock_item` et `update_item`. Chacune écrit l'article et son `stock_movement` dans la même transaction, sous RLS ; l'app les appellera aussi.
- **Lectures** : la vue `inventory_status` fournit l'aliment lié et `low_stock`.

### `add_items` : rien n'est deviné

Pour chaque article acheté, les règles s'appliquent dans cet ordre :

1. Avec `item_id`, l'achat réapprovisionne cet article.
2. Si un article en stock porte le même nom (sans accents ni pluriel), au même emplacement quand celui-ci est précisé, l'achat le réapprovisionne. S'il y en a plusieurs, la réponse est `several_items`.
3. Sinon, l'aliment de référence est cherché :
   - avec `food_ref_id`, l'aliment choisi est utilisé ;
   - avec `food_ref_id: null`, l'article n'a pas d'aliment (sauce de marque…) ;
   - sinon, c'est le rapprochement prudent de l'import Notion. Un aliment ambigu donne la raison `food`, avec jusqu'à 5 candidats et les articles en stock au nom proche.
4. Si un article en stock est lié au même aliment (« Riz » pour « Riz long »), l'achat le réapprovisionne.
5. Sinon, l'article est créé. Son emplacement par défaut dépend de la catégorie : frais et fait maison au frigo, le reste au placard.

Le réassort suit le mode de suivi de l'article :
- **En niveau** : l'article repasse à « plein », quelle que soit la quantité achetée (`delta` = +1 contenant).
- **En quantité** : il faut une quantité dans la même unité, sinon la réponse est `quantity_required` ou `unit_mismatch`. Les unités de saisie (kg, cl, l) sont converties en g ou ml.
- **Date de péremption** : on garde la plus proche des deux lots.

La réponse a trois listes, `created`, `restocked` et `ambiguous`. Chaque entrée ambiguë porte sa raison, une indication pour Claude (`hint`), et les candidats ou articles à proposer. Claude relance seulement ces articles avec la précision.

**Idempotence** : `idempotency_key` (optionnelle, 8 à 128 caractères) est réservée dans la table `idempotent_call`, dans la même transaction que les écritures. Un appel rejoué avec la même clé, par exemple après un timeout, renvoie la réponse enregistrée avec `replayed: true` et ne réécrit rien. Si l'appel échoue, la clé est libérée avec le reste.

### `update_item`

- Seuls les champs donnés changent ; `null` efface une date, un seuil ou l'aliment.
- Passer de la quantité au niveau, ou l'inverse, efface l'ancien suivi et son seuil.
- Une correction de stock dans la même unité, ou d'un niveau à l'autre, est tracée en `stock_movement` « manuel ».
- Un changement d'unité ou de mode de suivi est signalé dans la réponse (`notice`), puisqu'il efface le seuil et n'écrit pas de mouvement. Un seuil incompatible avec le mode (seuil en quantité sur un article suivi en niveau) est refusé avec un message en français.

### Liste « À racheter »

Un article y figure quand sa quantité est au seuil de rachat ou en dessous, ou quand son niveau est au seuil ou plus vide. Sans seuil, un article n'y figure jamais.

### Erreurs

Une saisie refusée par la base (article introuvable, unité incompatible…) revient à Claude comme erreur du tool, avec le message français de la fonction SQL. Une autre erreur donne un `500`, avec seulement le code dans les logs.

## Tools de suivi

| Tool | Rôle |
|---|---|
| `log_meal` | Repas hors recette : libellé, aliments et quantités dites |
| `log_workout` | Séance : type, durée, intensité ressentie de 1 à 5 |
| `log_weight` | Pesée en kg |
| `get_summary` | Résumé d'un jour ou d'une semaine (lundi-dimanche) |

**Règles communes :**
- **Entrées** : schémas Zod et logique pure dans `packages/core/src/tracking.ts`.
- **Idempotence** : chaque `log_*` exige une `idempotency_key`. Rejoué, il renvoie l'enregistrement existant (`replayed: true`) grâce aux contraintes `unique (user_id, idempotency_key)` de `meal`, `workout` et `body_measure`. Le contenu d'un rejeu est ignoré : pour corriger un enregistrement, il faut une nouvelle clé.
- **Dates** : elles sont en ISO avec fuseau, et valent maintenant par défaut. Les journées sont découpées à l'heure de Paris (`TIMEZONE`).

### `log_meal` : totaux depuis `food_ref`, jamais par Claude

1. Chaque aliment est rattaché à `food_ref` :
   - par `food_ref_id` choisi ;
   - par `null` quand aucun aliment de référence ne correspond, l'aliment est alors gardé par son nom ;
   - ou par le rapprochement prudent de l'inventaire.

   Si un seul aliment est ambigu, rien n'est enregistré : la réponse (`logged: false`) liste les candidats, et Claude relance tout le repas.
2. La fonction SQL `log_meal` enregistre le repas et ses aliments, avec la quantité dite (`quantity`, `unit`) et sa conversion en grammes (`to_grams`) :
   - grammes : tels quels ;
   - pièces : seulement avec le poids moyen de `food_ref` (`piece_weight_g`) ;
   - ml : jamais, faute de densité.
3. `meal_totals` calcule les totaux pour toutes les clés (colonnes principales, `micronutrients`, `nutrient_details`), sur les aliments convertis en grammes : `{ "values": {…}, "incomplete": [clés] }`.
   - Une clé absente de tous les aliments est « non renseignée ».
   - Une clé absente de certains aliments seulement est dans `incomplete` : son total est un minimum.
4. `meal.partial_values` vaut vrai dès qu'un aliment n'a pas de référence ou n'a pas pu être converti en grammes.

> **Limite actuelle** : Ciqual ne fournit ni poids moyen par pièce ni densité. « 2 œufs » ou « 15 ml de sauce soja » rendent donc le repas partiel, plutôt que d'inventer un poids. Pour avoir des totaux complets, il faut donner les grammes quand on les connaît. La quantité dite est gardée pour recalculer le jour où ces données existeront.

### `get_summary`

Le résumé contient :
- les totaux des colonnes principales, avec `incomplete` et `partial_values` ;
- les repas, les séances et les minutes de sport ;
- selon la période :
  - pour un jour : les pesées du jour ;
  - pour une semaine : un résumé par jour et le poids moyen, plutôt qu'au jour le jour.

Il n'y a aucun objectif ni jugement, et les descriptions des tools rappellent à Claude de rester neutre sur le poids, les quantités et les calories.

## Logs

Les logs ne contiennent que des événements, des identifiants et des codes d'erreur (`log.ts`), jamais de contenu ni de message d'erreur Postgres, qui peut contenir des valeurs. Événements actuels :
- `auth_refused`, avec la raison et les en-têtes d'authentification reçus : leur nom, la longueur de leur valeur et si elle commence par `kura_`, jamais la valeur elle-même ;
- `auth_unavailable`, avec le code ;
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
- **Avec base** :
  - `db_test.ts` vérifie que `asUser` applique la RLS et que les clés révoquées sont refusées ;
  - `tools/inventory_test.ts` déroule les tools d'inventaire de bout en bout avec le client MCP officiel.
  - `tools/tracking_test.ts` déroule les tools de suivi : ambiguïté sans enregistrement, totaux et valeurs partielles, rejeux sans doublon, journées à l'heure de Paris, aucune donnée dans les logs.

  La CI les lance contre sa base ; en local, il suffit de définir `KURA_TEST_DB_URL` :

  ```bash
  KURA_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm functions:test
  ```

## Code partagé avec `packages/core`

La fonction importe `@kura/core` grâce à l'import map de `supabase/functions/mcp/deno.json`, qui pointe vers `packages/core/src`. Deno exige des imports relatifs avec extension, donc `packages/core` écrit les siens avec `.ts` (`./schemas.ts`). Deno est épinglé par pnpm (`devEngines.runtime` du `package.json`, téléchargé à l'installation) : utiliser `pnpm exec deno …`. L'edge runtime Supabase est compatible avec Deno 2.1.
