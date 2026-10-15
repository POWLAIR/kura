---
name: implement-issue
description: Implémente une issue GitHub de Kura de bout en bout — lecture, branche, code, tests, PR. À utiliser quand on demande de traiter, implémenter ou prendre une issue (« fais l'issue 12 »).
---

# Implémenter une issue

1. `gh issue view <n> --comments` : lis l'issue, ses critères d'acceptation et la phase (label `phase-N`). Relis la section correspondante de `docs/conception.md`.
2. Si un critère est ambigu ou contredit la conception, demande avant de coder.
3. Vérifie que tu agis en tant que **POWLAIR** : `git config user.email` doit valoir `114736502+POWLAIR@users.noreply.github.com` et `gh auth status` doit montrer le compte actif `POWLAIR`. Sinon, arrête-toi et signale-le.
4. Crée la branche : `git switch -c <type>/<n>-<slug>` (`feat`, `fix`, `chore`, `docs`).
5. Implémente. Respecte les règles de `CLAUDE.md` (RLS, Zod partagé, pas d'estimation nutritionnelle par LLM, ton du compagnon).
6. Ajoute ou mets à jour les tests : Vitest pour `packages/core`, pgTAP (`supabase/tests/`) pour SQL et RLS.
7. `pnpm check` doit passer ; pour une migration, `pnpm db:reset` puis `pnpm db:types`.
8. Commits en Conventional Commits, en français : `feat(inventaire): ajoute le seuil de rachat`.
9. Ouvre la PR avec `gh pr create --fill`, corps selon `.github/pull_request_template.md`, avec `Closes #<n>`.
