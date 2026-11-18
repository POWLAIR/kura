# App Expo

L'app de Kura (`apps/mobile`) : Expo SDK 58 avec Expo Router, pour Android, et sur le web en PWA installable (https://powlair.github.io/kura/). Elle parle à la même base Supabase que le serveur MCP, avec la session de l'utilisateur : la RLS s'applique partout.

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
  app.config.ts           Ajoute le sous-chemin du build web (KURA_WEB_BASE_URL)
  public/icons/           Icônes de la PWA
  scripts/                finish-web-export.mts : manifeste, balises PWA et 404.html après le build web
  src/app/                Routes Expo Router
    _layout.tsx           Garde de session : connexion sans session, onglets avec
    sign-in.tsx           Connexion par email et mot de passe
    (tabs)/               Les quatre onglets : Accueil, Cuisine, Recettes, Journal
    (tabs)/cuisine/       Inventaire, ajout d'un article, fiche d'un article, scan des courses
    (tabs)/journal/       Frise du jour, semaine, saisie d'un repas, d'une séance, d'une pesée
  src/auth/session.tsx    Session Supabase Auth, partagée par contexte
  src/auth/               Stockage chiffré de la session (encrypted-storage.ts, session-storage.ts)
  src/lib/supabase.ts     Client Supabase typé avec database.types.ts
  src/lib/api.ts          Appel d'une opération métier (fonction api)
  src/inventory/          Lectures de l'inventaire et logique des formulaires (testée avec Vitest)
  src/journal/            Lectures du journal et logique de ses formulaires (testée avec Vitest)
  src/components/ui.tsx   Boutons, champs, choix en pastilles, messages
  src/lib/env.ts          Lecture et contrôle des variables publiques
  src/lib/layout.ts       Seuil du grand écran (useWideLayout)
  src/lib/pwa.ts          Manifeste et balises de la PWA (testés avec Vitest)
  src/theme.ts            Couleurs (clair et sombre) et espacements
```

- **Session** : gardée sur l'appareil par supabase-js et rafraîchie quand l'app est au premier plan. Sur Android, elle est chiffrée (`src/auth/encrypted-storage.ts`) : une clé, renouvelée à chaque écriture, est dans le stockage sûr de l'appareil (Keystore, via `expo-secure-store`) ; la session, trop grande pour lui, est dans AsyncStorage, chiffrée (AES-256) et scellée : le sceau est vérifié avant tout déchiffrement. Chaque écriture range sa clé sous un nom à elle, et l'ancienne paire reste valide tant que la nouvelle n'est pas complète : une écriture interrompue ne déconnecte pas. Lectures et écritures passent une par une. Une clé perdue, une valeur altérée ou un stockage sûr indisponible ramènent à l'écran de connexion, sans erreur. Une session en clair d'une version précédente est relue une fois, puis chiffrée. Sur le web, elle reste dans `localStorage` : un navigateur n'a pas de stockage sûr équivalent.
- **Opérations métier** (courses, repas, séances…) : par la fonction `api`, qui exécute le même code que les tools MCP (voir `docs/api.md`). Les lectures simples se font en direct avec supabase-js.
- **`packages/core`** : importé tel quel (`@kura/core`), comme dans le serveur MCP. Metro résout ses imports en `.ts` sans configuration.
- **Couleurs** : ni rouge ni vert pour porter un sens, comme le demande la conception.
- **Web** : `web.output` vaut `single` (une seule page, sans rendu côté serveur), ce qui suffit pour la PWA (voir « Version web (PWA) »).

## Accueil

- **Compagnon provisoire** (`components/companion.tsx`) : une forme simple dessinée avec des vues, sans animation ni machine à états. Le personnage final (Rive, six états) arrive en phase 5, et son identité reste à valider. Sa phrase parle de la cuisine : un produit qui attend d'être cuisiné, ou rien.
- **Aujourd'hui** : les repas, séances et pesées du jour, lus par `get_summary` comme le Journal ; seulement leur nombre et les minutes de sport, le détail est dans le Journal.
- **À surveiller** : les articles périmés ou qui périment dans les trois jours (`expiringSoon`), le plus proche d'abord ; un appui ouvre la fiche.

Le bouton « Qu'est-ce que je mange ? » ouvre les propositions de recettes. « Réglages » mène aux clés du connecteur et à la déconnexion.

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

## Onglet Recettes

Le parcours « cuisiner avec ce qu'on a » de la conception.

- **Liste** (`recettes/index.tsx`) : « Qu'est-ce que je mange ? », puis les recettes enregistrées (`get_recipes`) : favorites, déjà cuisinées, dernières propositions.
- **Propositions** (`recettes/proposer.tsx`, aussi depuis l'Accueil) : temps disponible, portions, envie facultative, puis la fonction `recipes` (API Anthropic, voir `docs/api.md`). Trois recettes, celles qui utilisent un produit qui périme bientôt d'abord, avec la mention « Utilise ce qui périme bientôt : … » et les valeurs par portion.
- **Fiche** (`recettes/[id].tsx`) : chaque ingrédient avec ce qu'en dit le stock (`ingredientAvailability` : « En stock : 1 kg », « Il en reste 150 g », « Pas dans le stock »), les étapes, et la carte nutrition par portion (`recipe_totals`, vitamines et minéraux compris).
- **« J'ai cuisiné »** (`recettes/cuisiner.tsx`) : portions cuisinées (le stock est décompté pour elles, par défaut la recette entière) et portions mangées (le repas les compte), puis `cook_recipe`, avec une clé d'idempotence par saisie. Le récapitulatif liste ce qui a été retiré du stock et ce qui reste à ajuster dans la Cuisine (article suivi en niveau, unité non convertible, stock épuisé), avec un lien vers chaque article, puis « Voir le repas ».
- **Supprimer un repas cuisiné** depuis sa fiche du Journal remet en stock ce qui avait été retiré.

## Onglet Journal

- **Jour** (`journal/index.tsx`) : la frise des repas, séances et pesées, à l'heure de Paris, lue par l'opération `get_summary` : les mêmes journées que pour Claude. Chaque repas porte ses valeurs principales (`nutritionBrief`), lues dans `meal.nutrition_totals` ; sous la frise, le total des repas du jour.
- **Semaine** : un jour par ligne (repas, valeurs, minutes de sport), le total de la semaine, et le poids en moyenne plutôt qu'au jour le jour. Un appui sur un jour l'ouvre.
- **Valeurs** : une valeur absente s'écrit « non renseignée », jamais zéro ; un total dont il manque une partie s'écrit « au moins … » ; un repas dont un aliment n'a pas pu être compté est « valeurs partielles ». Ni objectif, ni jugement, ni couleur.
- **Carte nutrition** (`components/nutrition-card.tsx`), sur le jour et la fiche d'un repas, puis sur la fiche recette : les valeurs principales toujours visibles ; vitamines et minéraux dans une section dépliable, les plus courants d'abord (`micronutrientRows`, `sumMicronutrients`, lus dans `meal.nutrition_totals` : `get_summary` ne les donne pas, pour garder une réponse courte à Claude). Toucher une valeur ouvre sa fiche « À quoi ça sert » : deux ou trois phrases et leurs sources (Anses, Manger Bouger), écrites une fois dans `packages/core/src/nutrient-info.ts`, jamais générées. Un test refuse dans ces fiches tout mot qui juge ou fixe un objectif. La semaine n'affiche que les valeurs principales.
- **Saisir** : une séance (`journal/seance.tsx`), une pesée (`journal/pesee.tsx`), un repas (`journal/repas.tsx`). Le repas se compose d'aliments cherchés par leur nom dans `food_ref`, ou d'un produit scanné ; la quantité se donne dans l'unité dite (g, ml, pièce…) et l'enregistrement passe par `log_meal`, qui calcule les valeurs côté serveur.
- **Poids d'une pièce, densité** : quand `log_meal` signale une conversion manquante, l'écran demande la mesure à l'utilisateur (`set_food_conversion`) ; rien n'est estimé, et « Plus tard » laisse le repas en valeurs partielles.
- **Corriger** : un appui sur une séance ou une pesée ouvre sa fiche (`update_workout`, `update_weight`, suppression). Un appui sur un repas ouvre sa fiche (`journal/fiche-repas.tsx`) : ses aliments tels que dits, leurs grammes, leur aliment de référence et ses valeurs ; il s'y supprime, puis se ressaisit, comme avec les tools MCP (`delete_entry`).
- **Dates et heures** : tapées (`12/11`, `12h30`) et converties à l'heure de Paris (`zonedIso`) ; sans année, une date du journal est la dernière fois qu'elle est arrivée.

Hors de cette version : la tendance de poids lissée (phase 4).

## Réglages

Accueil → « Réglages » (`src/app/reglages.tsx`).

- **Clés du connecteur Claude** : la liste (nom, 12 premiers caractères, création, dernière utilisation, révoquée ou non) est lue directement dans `api_key`, sous RLS, sans jamais sélectionner le hash.
- **Créer une clé** : opération `create_api_key`. La clé est générée et hachée par la fonction `api` ; elle revient en clair dans la réponse et s'affiche une seule fois. Seul son hash SHA-256 est en base.
- **Révoquer** : opération `revoke_api_key`, après confirmation. Le serveur MCP refuse la clé dès la requête suivante ; elle ne peut pas être réactivée.
- **Exporter mes données** : opération `export_data`, puis remise du fichier `kura-export-<date>.json` : un téléchargement sur le web, la feuille de partage du système sur Android (`src/lib/save-file.ts`). Sur Android, le fichier contient des données de santé : il est effacé du cache de l'app après le partage, et tout export oublié l'est au prochain export et à la déconnexion.
- **Se déconnecter**.
- **Supprimer mon compte** : après avoir tapé « SUPPRIMER », la fonction `delete-account` efface le compte et toutes ses données ; l'app revient à l'écran de connexion. Voir `docs/api.md`.

`pnpm mcp:key` reste utilisable depuis un terminal (voir `docs/mcp.md`).

## Version web (PWA)

L'app web est publiée sur GitHub Pages, à l'adresse https://powlair.github.io/kura/, et s'installe depuis le navigateur (Chrome ou Edge : icône d'installation dans la barre d'adresse).

- **Grand écran** : à partir de 900 px de large (`src/lib/layout.ts`), les onglets forment une colonne à gauche et les écrans passent en colonnes. Le gabarit `Screen` accepte une seconde colonne (`aside`) : « À surveiller » sur l'Accueil, les totaux dans le Journal. Dans Cuisine, chaque emplacement a sa colonne. En dessous de 900 px, rien ne change : onglets en bas, une seule colonne.
- **Build** : `pnpm --filter @kura/mobile export:web` lance `expo export`, puis `scripts/finish-web-export.mts`, qui écrit `manifest.webmanifest`, ajoute au `<head>` le manifeste, l'icône iOS et la couleur de la barre du navigateur, et copie `index.html` en `404.html`. GitHub Pages ne connaît pas les routes de l'app : une adresse comme `/kura/journal` reçoit cette page, et Expo Router ouvre le bon écran.
- **Sous-chemin** : GitHub Pages sert l'app sous `/kura`. `KURA_WEB_BASE_URL=/kura` le donne au build (`app.config.ts` le passe à `experiments.baseUrl`). Sans cette variable, l'app est servie à la racine, comme avec `pnpm app`.
- **Pas de service worker** : l'app a besoin du réseau pour joindre Supabase, et un cache hors ligne servirait d'anciennes versions. Chrome et Edge l'installent sans service worker.
- **Données** : GitHub Pages ne sert que des fichiers statiques. Le navigateur parle directement à Supabase ; la session reste dans `localStorage` (voir plus haut).

### Déploiement

Le workflow `.github/workflows/pages.yml` publie l'app à chaque push sur `main` qui touche l'app ou `packages/core`, et peut aussi se lancer à la main (**Actions → PWA → Run workflow**). Une seule mise en place :

1. **Settings → Pages → Source : GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** : `EXPO_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`) et `EXPO_PUBLIC_SUPABASE_KEY` (clé **publique** `sb_publishable_…`). Ce sont des variables, pas des secrets : elles finissent dans l'app publiée, lisible par tous. Le build s'arrête si l'une manque.
3. Autoriser l'origine de la PWA dans les Edge Functions : `pnpm exec supabase secrets set KURA_APP_ORIGINS=https://powlair.github.io` (voir `docs/api.md`).

## Vérifications

```bash
pnpm check                                   # lint (Biome), typecheck et tests, app comprise
pnpm --filter @kura/mobile export:web        # build web, dans apps/mobile/dist
```

La CI lance les deux. Le build web y reçoit des valeurs factices : il vérifie seulement que l'app se compile.

TypeScript est en version 7, comme le reste du dépôt, alors qu'Expo 58 attend la 6 : `expo install --check` l'ignore (`expo.install.exclude` dans le `package.json` de l'app).
