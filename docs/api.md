# API de l'app

L'app Expo ne parle pas au serveur MCP. Elle appelle une seconde Edge Function, `api` (`supabase/functions/api/`), qui exécute **les mêmes opérations que les tools MCP**, avec le même code.

## Pourquoi

Enregistrer des courses ou un repas, ce n'est pas une requête : il faut charger le stock et `food_ref`, décider (`planPurchase`, `resolveMealItems`), écrire, tenir l'idempotence, le tout dans une seule transaction. L'app, qui parle à PostgREST, ne peut pas rejouer cela telle quelle. Plutôt que de dupliquer cette logique dans l'app, elle vit dans `supabase/functions/_shared/` et sert aux deux fonctions.

```
supabase/functions/
  _shared/
    operations.ts   La liste des opérations : un schéma Zod de @kura/core et une fonction chacune
    inventory.ts    get_inventory, add_items, update_item, remove_item, get_shopping_list
    tracking.ts     log_meal, log_workout, log_weight, get_summary, corrections, conversions
    db.ts           Connexion Postgres et asUser (RLS)
    http.ts         Entrée commune des fonctions de l'app : origine, méthode, session, corps JSON
    session.ts      Vérification du jeton de session auprès de Supabase Auth
    cors.ts         Origines autorisées
    errors.ts       Erreurs de saisie renvoyées à l'appelant
    log.ts          Logs : ids et codes d'erreur seulement
  mcp/              Ce que lit Claude : titres, descriptions, consignes ; auth par clé API
  api/              Ce qu'appelle l'app : les opérations, par leur nom
  off-product/      Produit par code-barres (docs/open-food-facts.md)
  delete-account/   Suppression du compte (seule à utiliser la clé service_role)
```

Une opération ajoutée à `OPERATIONS` est disponible dans l'API ; elle devient un tool MCP quand on lui écrit sa description dans `mcp/tools/`.

Trois opérations sont réservées à l'app et n'ont pas de tool MCP : `create_api_key` et `revoke_api_key` (clés du connecteur, `_shared/api-keys.ts`), et `export_data` (`_shared/account.ts`).

Ce qui reste en direct dans l'app, avec supabase-js : les lectures simples (vue `inventory_status`, tables sous RLS) et les RPC unitaires (`update_item`…).

## Appel

`POST /functions/v1/api/<opération>`, avec en corps JSON l'entrée de l'opération ; un corps vide vaut `{}`, pour les lectures sans filtre. Les noms et les entrées sont ceux des tools MCP (voir `docs/mcp.md`) : `get_inventory`, `add_items`, `update_item`, `remove_item`, `get_shopping_list`, `log_meal`, `set_food_conversion`, `log_workout`, `log_weight`, `delete_entry`, `update_workout`, `update_weight`, `get_summary`.

Depuis l'app :

```ts
const { data, error } = await supabase.functions.invoke("api/add_items", {
  body: { items: [{ name: "Riz", quantity: 1, unit: "kg" }], idempotency_key },
});
```

| Statut | Corps | Sens |
|---|---|---|
| 200 | la réponse de l'opération | Même contenu que le tool MCP : `created`, `restocked`, `ambiguous`, `replayed`… |
| 400 | `error.code` : `invalid_json`, `invalid_input` (+ `issues`) | Entrée refusée par le schéma Zod |
| 401 | `unauthenticated` | Session absente ou expirée |
| 403 | `origin_refused` | Page web d'une origine non autorisée |
| 404 | `unknown_operation` | |
| 422 | `refused` | Saisie refusée par la base : `error.message` est le message en français de nos fonctions SQL (article introuvable, unité incompatible…), ou celui de Postgres pour une contrainte (valeur hors bornes, référence inconnue) |
| 500 | `internal` | Erreur interne ; seul son code est dans les logs |
| 503 | `auth_unavailable` | Le service d'authentification ne répond pas : réessayer, la session n'est pas en cause |

## Export et suppression du compte

Les deux droits sur ses données prévus par la conception (« Sécurité et données de santé »).

**`export_data`** (opération de `api`) renvoie toutes les données de l'utilisateur en JSON : `{ format: 1, exported_at, tables: { <table>: [lignes] } }`. Les tables sont lues telles quelles, sous RLS : `inventory_item`, `stock_movement`, `recipe`, `recipe_ingredient`, `meal`, `meal_item`, `workout`, `body_measure`, `food_conversion`, `companion_event`, puis `api_key` sans le hash des clés, et les lignes de `food_ref` que ces données citent. `idempotent_call` n'y figure pas : c'est un cache technique de réponses déjà présentes ailleurs.

**`delete-account`** (`supabase/functions/delete-account/`) supprime le compte : `POST /functions/v1/delete-account`, corps `{ "confirm": "SUPPRIMER" }`, avec la session de l'utilisateur.

- L'id du compte vient de la session, jamais du corps : on ne supprime que son propre compte.
- La fonction supprime le compte Supabase Auth par l'API d'administration ; toutes les lignes de l'utilisateur partent avec lui, chaque table référençant `auth.users` en `on delete cascade`. Un test vérifie qu'il ne reste aucune ligne portant ce `user_id`, dans aucune table.
- **C'est la seule fonction de Kura à utiliser la clé `service_role`** (`SUPABASE_SERVICE_ROLE_KEY`, fournie d'office aux Edge Functions) : elle ne sert qu'à cet appel et ne sort pas du serveur.
- Réponses : 200 `{ deleted: true }` ; 400 sans le mot de confirmation ; 401 sans session ; 502 `delete_failed` si Supabase Auth refuse, auquel cas rien n'est supprimé.
- Logs : `delete_account_error` avec un code, rien d'autre.

## Authentification

L'app envoie le jeton de session Supabase de l'utilisateur (`Authorization: Bearer …`), ce que fait `supabase.functions.invoke`.

1. La plateforme vérifie le jeton avant d'appeler la fonction (`verify_jwt = true` dans `supabase/config.toml`).
2. La fonction demande à Supabase Auth à qui il appartient (`GET /auth/v1/user`). Auth contrôle la signature, l'expiration et la session : un compte déconnecté ou supprimé est refusé.
3. Tout s'exécute ensuite dans `asUser`, avec le rôle `authenticated` et l'id de l'utilisateur : la RLS s'applique, comme pour le serveur MCP.

La fonction n'utilise jamais la clé `service_role`.

## CORS

L'app Android n'envoie pas d'en-tête `Origin`. Une page web n'est acceptée que depuis :

- `localhost`, pour le développement (`pnpm app`, puis « w ») ;
- les origines de l'app web, listées dans le secret `KURA_APP_ORIGINS`, séparées par des virgules. À définir quand la PWA sera hébergée (#32) :

```bash
pnpm exec supabase secrets set KURA_APP_ORIGINS=https://<domaine de la PWA>
```

Toute autre origine reçoit un `403`. En local, la passerelle répond elle-même aux requêtes de préflight (`OPTIONS`) ; en ligne, c'est la fonction.

## Logs

Trois événements, sans aucun contenu : `auth_refused` (jeton absent ou refusé), `auth_unavailable` (code), `api_error` (opération et code). Ni entrée, ni message d'erreur Postgres.

## Tests

`supabase/functions/api/handler_test.ts`, lancé par `pnpm functions:test` :

- sans base : refus (origine, méthode, opération, session), CORS, auth injoignable, saisie invalide, rien de sensible dans les logs ;
- avec base (`KURA_TEST_DB_URL`) : mêmes réponses que les tools, RLS entre deux utilisateurs, rejeu idempotent, saisie refusée.

En local, à travers la passerelle :

```bash
pnpm db:start
pnpm exec supabase functions serve
# → http://127.0.0.1:54321/functions/v1/api/<opération>
```
