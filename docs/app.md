# App Expo

L'app de Kura (`apps/mobile`) : Expo SDK 58 avec Expo Router, pour Android d'abord, puis le web en PWA (issue #32). Elle parle à la même base Supabase que le serveur MCP, avec la session de l'utilisateur : la RLS s'applique partout.

## Lancer l'app

Il faut Node 22 (`.nvmrc`) et, pour la base locale, Docker.

```bash
pnpm install
pnpm db:start     # Supabase local ; affiche l'URL et la clé publique
pnpm app          # Expo : QR code pour Expo Go sur Android, « w » pour le web
```

### Variables d'environnement

L'app lit deux variables, à mettre dans un fichier `.env` placé dans `apps/mobile/` (jamais commité) :

| Variable | Valeur |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | URL du projet : `http://127.0.0.1:54321` en local, `https://<ref>.supabase.co` en ligne |
| `EXPO_PUBLIC_SUPABASE_KEY` | Clé **publique** du projet (`sb_publishable_…`, ou l'ancienne clé `anon`) |

Tout ce qui commence par `EXPO_PUBLIC_` est embarqué dans l'app et lisible par quiconque l'installe. La clé secrète (`sb_secret_…`) et la clé `service_role` n'y vont jamais : l'app refuse de démarrer si elle en reçoit une (`src/lib/env.ts`).

### Sur le téléphone (Expo Go)

Le téléphone doit joindre Supabase. Deux façons :

- **Base déployée** : mettre l'URL et la clé publique du projet en ligne dans le `.env` de l'app. C'est le plus simple.
- **Base locale** : remplacer `127.0.0.1` par l'adresse de l'ordinateur sur le réseau local. Sous WSL2, le port 54321 doit en plus être redirigé depuis Windows.

### Compte

L'app n'a pas d'écran d'inscription : en usage solo, les inscriptions sont fermées (voir `docs/deploiement.md`). Le compte se crée dans le dashboard Supabase, ou en local dans Studio (**Authentication → Users → Add user**).

## Structure

```
apps/mobile/
  app.json                Configuration Expo (nom, icônes, schéma d'URL « kura »)
  src/app/                Routes Expo Router
    _layout.tsx           Garde de session : connexion sans session, onglets avec
    sign-in.tsx           Connexion par email et mot de passe
    (tabs)/               Les quatre onglets : Accueil, Cuisine, Recettes, Journal
  src/auth/session.tsx    Session Supabase Auth, partagée par contexte
  src/lib/supabase.ts     Client Supabase typé avec database.types.ts
  src/lib/env.ts          Lecture et contrôle des variables publiques
  src/theme.ts            Couleurs (clair et sombre) et espacements
```

- **Session** : gardée sur l'appareil par supabase-js (AsyncStorage sur Android, `localStorage` sur le web) et rafraîchie quand l'app est au premier plan.
- **`packages/core`** : importé tel quel (`@kura/core`), comme dans le serveur MCP. Metro résout ses imports en `.ts` sans configuration.
- **Couleurs** : ni rouge ni vert pour porter un sens, comme le demande la conception.
- **Web** : `web.output` vaut `single` (une seule page, sans rendu côté serveur), ce qui suffit pour la PWA.

## Vérifications

```bash
pnpm check                                   # lint (Biome), typecheck et tests, app comprise
pnpm --filter @kura/mobile export:web        # build web, dans apps/mobile/dist
```

La CI lance les deux. Le build web y reçoit des valeurs factices : il vérifie seulement que l'app se compile.

TypeScript est en version 7, comme le reste du dépôt, alors qu'Expo 58 attend la 6 : `expo install --check` l'ignore (`expo.install.exclude` dans le `package.json` de l'app).
