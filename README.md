# Kura

Cuisine, suivi et compagnon : inventaire, recettes générées depuis le stock, suivi alimentation/sport, et Miso, un petit onigiri qui réagit à tes habitudes. Utilisable depuis l'app ou directement en parlant à Claude (serveur MCP).

- Conception : [docs/conception.md](docs/conception.md)
- Stack : Expo · Supabase (Postgres, Auth, Edge Functions) · MCP TypeScript · API Claude · Ciqual / Open Food Facts · Rive

## Démarrer

```bash
pnpm install
cp .env.example .env
pnpm db:start
pnpm check
```

## Travailler avec Claude

- `CLAUDE.md` donne le contexte et les règles ; `.claude/` contient les permissions, un hook de formatage et des skills (`implement-issue`, `new-migration`).
- Sur GitHub, mentionner `@claude` dans une issue ou une PR lance Claude Code (workflow `claude.yml`). Les PR sont relues automatiquement (`claude-review.yml`).
