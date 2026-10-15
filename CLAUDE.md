# Kura

Outil personnel qui relie inventaire de cuisine, recettes, suivi alimentation/sport et un compagnon animé (Miso). Utilisable depuis une app Expo (Android + PWA) ou directement depuis Claude via un serveur MCP.

**Conception complète : @docs/conception.md** — à relire avant toute fonctionnalité. En cas de doute entre le code et la conception, demander.

## Structure

```
apps/mobile/          App Expo (phase 2, pas encore créée)
packages/core/        Schémas Zod + logique métier partagés app ↔ MCP (clés micronutriments : nutrients.ts)
scripts/              Imports ponctuels exécutés en local (Ciqual, Notion)
supabase/migrations/  Schéma Postgres, RLS, fonctions RPC (cook_recipe…)
supabase/functions/   Edge Functions Deno : mcp, recipes, notion-export…
supabase/tests/       Tests pgTAP (SQL + RLS)
docs/                 Conception et décisions (ciqual.md, notion.md : imports)
```

## Commandes

```bash
pnpm check            # lint + typecheck + tests — doit passer avant tout commit
pnpm format           # Biome --write
pnpm test             # Vitest
pnpm db:start         # Supabase local (Docker)
pnpm db:new <nom>     # nouvelle migration
pnpm db:reset         # rejoue toutes les migrations + seed
pnpm db:types         # régénère packages/core/src/database.types.ts
pnpm import:ciqual <dossier> [--dry-run]   # remplit food_ref (voir docs/ciqual.md)
pnpm import:notion <page> --dry-run        # inventaire initial depuis Notion (voir docs/notion.md)
pnpm exec supabase test db                 # tests pgTAP
pnpm exec supabase functions serve <nom>   # Edge Function en local
```

## Règles non négociables

- **RLS partout** : chaque table utilisateur a `user_id` + RLS activée. La clé `service_role` ne sort jamais des Edge Functions.
- **Nutrition = sources de référence** : valeurs issues de Ciqual / Open Food Facts via `food_ref`, jamais estimées par un LLM. Valeur absente → « non renseignée ». Conversion impossible → indicateur « valeurs partielles ».
- **Une seule source de vérité métier** : l'app et le serveur MCP appellent les mêmes fonctions et valident avec les mêmes schémas Zod de `packages/core`.
- **Atomicité** : « J'ai cuisiné » = RPC Postgres `cook_recipe` en une transaction.
- **Idempotence** : chaque tool `log_*` accepte une clé d'idempotence ; identifiants externes avec contrainte `unique`.
- **Données de santé** : aucun contenu de repas, poids ou séance dans les logs — seulement des ids et codes d'erreur. Ne transmettre qu'aux services listés dans la section Sécurité de la conception.
- **Ton du compagnon** : jamais de commentaire sur le poids, les quantités mangées ou les calories ; pas de code couleur rouge/vert ; l'humour vise la cuisine, jamais la personne.

## Conventions

- TypeScript strict partout ; Deno pour `supabase/functions`, Node 22+ (`.nvmrc`) ailleurs — `supabase-js` ne fonctionne plus en Node 20.
- Code et identifiants en anglais (`inventory_item`, `cookRecipe`), textes visibles par l'utilisateur en français.
- Migrations : jamais modifier une migration mergée (voir skill `new-migration`).
- Compte GitHub : **POWLAIR** (`git@github.com:POWLAIR/kura.git`). Commits, push et PR se font avec ce compte — identité git locale `POWLAIR <114736502+POWLAIR@users.noreply.github.com>`, jamais l'adresse pro du `~/.gitconfig` global. Vérifier `git config user.email` et `gh auth status` avant de pousser.
- Branches `feat/<issue>-<slug>`, Conventional Commits en français, une PR par issue avec `Closes #N`.
- Les issues sont organisées par milestone (Phase 1 → 5) et labels `phase-N` + module. Ne pas démarrer une phase avant que le critère de la précédente soit rempli.

## Phase en cours

**Phase 1 — Fondations** : schéma + RLS, import Ciqual, import Notion, serveur MCP (Streamable HTTP, Edge Function), auth par clé API. Critère de fin : une semaine de suivi via Claude seul.
