# Déploiement

Mise en ligne de Kura sur Supabase, en région UE, puis branchement de Claude sur le serveur MCP (issue #9). Les étapes sont à lancer à la main, dans l'ordre. Elles touchent la base de production ; Claude Code n'a pas le droit de lancer `supabase db push`.

## 1. Projet Supabase

1. Sur [supabase.com/dashboard](https://supabase.com/dashboard), crée un projet avec ces réglages :
   - nom : `kura` ;
   - région : **West EU (Paris)**, ou à défaut Central EU (Frankfurt) ;
   - mot de passe de base : un mot de passe généré, gardé dans ton gestionnaire.
2. Dans **Authentication → Sign In / Providers**, désactive **Allow new users to sign up**. En usage solo, seul ton compte existe.
3. Dans **Authentication → Users → Add user**, crée ton compte (email, mot de passe, *Auto Confirm User*).
4. Note la **référence du projet** (`Project Settings → General`, une vingtaine de lettres). Note aussi la **clé secrète** (`Project Settings → API Keys`, `sb_secret_…`).

## 2. Schéma et fonction

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push          # applique supabase/migrations (vérifie la liste avant de valider)
pnpm functions:deploy               # déploie supabase/functions/mcp (bundling côté Supabase)
```

- **Secrets** : aucun n'est à configurer. La fonction n'utilise que `SUPABASE_DB_URL`, fournie d'office aux Edge Functions. `verify_jwt = false` est repris de `supabase/config.toml`.
- **Si le déploiement ne trouve pas `packages/core`** : la fonction l'importe hors de `supabase/functions` (import map `@kura/core`). Il faut alors le signaler, et la solution sera de le copier dans `supabase/functions/_shared/` au moment du déploiement.

Vérification : sans clé, la fonction doit répondre `401`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<ref>.supabase.co/functions/v1/mcp
```

## 3. Données : Ciqual, inventaire, clé API

Les scripts locaux lisent `.env` par défaut. Pour viser la base déployée, crée `.env.production` à la racine. Il n'est jamais commité, et Claude Code ne le lit pas.

```bash
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…
NOTION_TOKEN=…
```

Puis lance chaque commande avec `KURA_ENV_FILE=.env.production`. Les scripts affichent la base visée (`Supabase : <ref>.supabase.co`) avant d'écrire.

```bash
# Référentiel Ciqual (voir docs/ciqual.md)
KURA_ENV_FILE=.env.production pnpm import:ciqual <dossier des XML Ciqual>

# Inventaire Notion : vérifier le dry-run, puis importer (voir docs/notion.md)
KURA_ENV_FILE=.env.production pnpm import:notion "https://app.notion.com/p/3f8a7a154ac181b3ab48c1689d0ea415" --dry-run --choices scripts/notion-choices.json
KURA_ENV_FILE=.env.production pnpm import:notion "https://app.notion.com/p/3f8a7a154ac181b3ab48c1689d0ea415" --user <email> --choices scripts/notion-choices.json

# Clé API du connecteur, affichée une seule fois : la copier dans ton gestionnaire
KURA_ENV_FILE=.env.production pnpm mcp:key --user <email> --label "Claude"
```

## 4. Connecteur Claude

Dans claude.ai, va dans **Paramètres → Connecteurs → Ajouter un connecteur personnalisé** et renseigne :

- nom : `Kura` ;
- URL : `https://<ref>.supabase.co/functions/v1/mcp` ;
- en-tête de requête : `Authorization` = `Bearer kura_…` (la clé de l'étape 3).

Un connecteur ajouté sur le web est aussi disponible dans les apps Claude iOS et Android. Active-le dans une conversation avec le menu des outils.

**Si le formulaire n'a pas de champ d'en-tête** : il ne propose alors qu'OAuth. Le serveur n'accepte que la clé en en-tête, et il ne faut pas la mettre dans l'URL, où elle finirait dans les logs. La solution prévue est d'avancer l'OAuth de Supabase Auth, prévu en phase 3 (conception, « Serveur MCP »). En attendant, le serveur reste utilisable depuis Claude Code.

**Claude Code**, avec une clé à part, révocable séparément :

```bash
claude mcp add --transport http --scope user kura https://<ref>.supabase.co/functions/v1/mcp --header "Authorization: Bearer kura_…"
```

## 5. Test de bout en bout

Depuis l'app Claude mobile, avec le connecteur Kura activé :

1. « J'ai acheté 1 kg de riz » : Claude appelle `add_items`. Si le riz est ambigu, il propose les candidats Ciqual ou l'article « Riz long » déjà en stock.
2. « Ce midi riz et deux œufs » : Claude appelle `log_meal`. Les œufs, comptés en pièces, rendent le repas « valeurs partielles » tant qu'aucun poids moyen n'existe.
3. « Résumé de ma journée » : Claude appelle `get_summary`.

Côté Supabase, **Edge Functions → mcp → Logs** ne doit montrer que des événements et des codes (`auth_refused`, `mcp_error`), jamais de contenu.

## Exploitation

- **Nouvelle migration** : `pnpm exec supabase db push`, après merge sur `main`.
- **Nouvelle version de la fonction** : `pnpm functions:deploy`.
- **Clé compromise ou perdue** : `KURA_ENV_FILE=.env.production pnpm mcp:key --revoke <12 premiers caractères>`, puis crée une nouvelle clé et mets-la à jour dans le connecteur.
- **Dernière utilisation d'une clé** : `api_key.last_used_at`, dans le Table Editor.
