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
    (tabs)/cuisine/       Inventaire, ajout d'un article, fiche d'un article
  src/auth/session.tsx    Session Supabase Auth, partagée par contexte
  src/auth/               Stockage chiffré de la session (encrypted-storage.ts, session-storage.ts)
  src/lib/supabase.ts     Client Supabase typé avec database.types.ts
  src/lib/api.ts          Appel d'une opération métier (fonction api)
  src/inventory/          Lectures de l'inventaire et logique des formulaires (testée avec Vitest)
  src/components/ui.tsx   Boutons, champs, choix en pastilles, messages
  src/lib/env.ts          Lecture et contrôle des variables publiques
  src/theme.ts            Couleurs (clair et sombre) et espacements
```

- **Session** : gardée sur l'appareil par supabase-js et rafraîchie quand l'app est au premier plan. Sur Android, elle est chiffrée (`src/auth/encrypted-storage.ts`) : une clé, renouvelée à chaque écriture, est dans le stockage sûr de l'appareil (Keystore, via `expo-secure-store`) ; la session, trop grande pour lui, est dans AsyncStorage, chiffrée (AES-256) et scellée : le sceau est vérifié avant tout déchiffrement. Une clé perdue ou une valeur altérée ramène à l'écran de connexion. Une session en clair d'une version précédente est relue une fois, puis chiffrée. Sur le web, elle reste dans `localStorage` : un navigateur n'a pas de stockage sûr équivalent.
- **Opérations métier** (courses, repas, séances…) : par la fonction `api`, qui exécute le même code que les tools MCP (voir `docs/api.md`). Les lectures simples se font en direct avec supabase-js.
- **`packages/core`** : importé tel quel (`@kura/core`), comme dans le serveur MCP. Metro résout ses imports en `.ts` sans configuration.
- **Couleurs** : ni rouge ni vert pour porter un sens, comme le demande la conception.
- **Web** : `web.output` vaut `single` (une seule page, sans rendu côté serveur), ce qui suffit pour la PWA.

## Onglet Cuisine

- **Liste** : lue directement dans la vue `inventory_status`, regroupée par emplacement puis par catégorie (`groupInventory` de `packages/core`). Une péremption à trois jours ou moins est mise en avant par une étiquette, sans rouge ni vert ; « À racheter » filtre les articles sous leur seuil.
- **Ajouter un article** : texte libre envoyé à l'opération `add_items`, donc avec les règles du tool MCP (`planPurchase`) : un article déjà en stock est réapprovisionné, sinon il est créé. Une ambiguïté se tranche à l'écran : aliment de référence parmi les candidats, article existant, ou « aucun ». Sans quantité, l'article est suivi en niveau.
- **Fiche d'un article** : quantité ou niveau, seuil de rachat, date, emplacement, catégorie, aliment de référence (recherche par nom dans `food_ref`). L'enregistrement passe par `update_item` et n'envoie que les champs modifiés ; un changement d'unité ou de mode de suivi est signalé avant de revenir à la liste.
- **Retirer un article** : opération `remove_item`, après confirmation. L'article quitte l'inventaire avec son historique de mouvements.
- **Dates** : saisies à la française (`24/12`, `24/12/2026`), converties par `parseDateInput`.

### Ranger les courses (scan)

Cuisine → « Scanner des courses » (`cuisine/scanner.tsx`, logique dans `src/inventory/scan.ts`).

1. La caméra (`expo-camera`) lit les codes EAN et UPC en continu. Un code relu dans les 2,5 secondes est le même passage devant l'objectif ; relu plus tard, c'est un emballage de plus (« × 2 »).
2. Chaque code passe par la fonction `off-product` (voir `docs/open-food-facts.md`). Le produit rejoint une liste temporaire, avec ce qui va se passer :
   - un article en stock est lié au même aliment : il sera réapprovisionné, à son emplacement ;
   - sinon c'est un nouvel article : sa catégorie est à choisir, son emplacement est proposé d'après elle et reste modifiable.
   La contenance de l'emballage est proposée comme quantité quand Open Food Facts la donne.
3. Un produit sans code-barres (fruits, légumes) s'ajoute par son nom, tapé ou dicté au clavier ; il est rapproché de Ciqual à l'envoi. Un code qui ne se scanne pas peut être tapé.
4. « Tout ranger » envoie toute la liste à `add_items` en un appel : une transaction, un `stock_movement` « achat » par ligne, une clé d'idempotence par envoi. Les lignes qu'`add_items` juge ambiguës restent à l'écran avec de quoi trancher, puis repartent avec une nouvelle clé.
5. Le résumé dit ce qui a été ajouté, réapprovisionné, et ce qui sort de la liste « À racheter ».

Rien n'est enregistré avant « Tout ranger ». Le scan fonctionne dans Expo Go ; sur le web, la caméra dépend du navigateur, et la saisie du code reste possible.

Les saisies sont validées par les schémas Zod de `packages/core` (`PurchaseItem`, `ItemChanges`) avant l'envoi, puis à nouveau par la fonction.

## Vérifications

```bash
pnpm check                                   # lint (Biome), typecheck et tests, app comprise
pnpm --filter @kura/mobile export:web        # build web, dans apps/mobile/dist
```

La CI lance les deux. Le build web y reçoit des valeurs factices : il vérifie seulement que l'app se compile.

TypeScript est en version 7, comme le reste du dépôt, alors qu'Expo 58 attend la 6 : `expo install --check` l'ignore (`expo.install.exclude` dans le `package.json` de l'app).
