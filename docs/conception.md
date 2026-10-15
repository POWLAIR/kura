# Conception — Cuisine, suivi & compagnon

> Source : doc Claude « Conception — Cuisine, suivi & compagnon » (https://claude.ai/code/artifact/29349fe6-a0ba-45ec-a5f2-e9d007d19b9e), exporté le 2026-10-15. Le doc reste la référence ; ce fichier est une copie pour Claude Code.

## Vision et périmètre

Un outil personnel qui relie trois choses aujourd'hui séparées : ce qu'il y a dans la cuisine, ce qu'on peut en faire, et ce qu'on mange et dépense en sport. Il s'utilise depuis une app mobile et desktop, ou directement en parlant à Claude via un serveur MCP.

Utilisateur : Paul, en usage solo. Pas de multi-utilisateur en V1, mais chaque table porte un `user_id` pour ne pas fermer la porte.

Le fil rouge est l'action « J'ai cuisiné ». Une seule action qui :

1. décrémente les ingrédients utilisés dans l'inventaire ;
2. crée une entrée de repas avec ses valeurs nutritionnelles calculées ;
3. fait réagir le compagnon.

Principes produit :

- Saisie minimale : chaque info s'entre en une phrase via Claude, un scan ou deux taps.
- Les valeurs nutritionnelles viennent de sources de référence (Ciqual, Open Food Facts), jamais d'une estimation du LLM.
- Le compagnon encourage des habitudes ; il ne commente jamais le poids ni les quantités mangées.
- Les données de santé restent privées et ne transitent que par les services listés dans la section Sécurité.

Hors périmètre V1 : multi-utilisateur, liste de courses partagée, planification de repas sur la semaine, objectifs nutritionnels chiffrés.

## Fonctionnalités

Cinq modules, tous branchés sur la même base Postgres et exposés à la fois dans l'app et via MCP.

### Inventaire

- Liste des ingrédients par catégorie (épices, féculents, sauces, frais, fait maison) et par emplacement (placard, frigo, congélateur).
- Quantité chiffrée avec unité (g, ml, pièce) ou niveau approximatif (plein, moitié, presque vide) pour les épices et sauces.
- Date de péremption optionnelle, mise en avant quand elle approche.
- Seuil de rachat : sous ce seuil, l'article passe automatiquement dans la liste « À racheter ».
- Ajout par scan de code-barres (Open Food Facts), par recherche dans Ciqual, ou en texte libre via Claude (« j'ai acheté 1 kg de riz et 6 œufs »).
- Import initial depuis la page Notion actuelle, puis export à sens unique vers une base Notion en lecture seule (inventaire et liste « À racheter »), mis à jour à chaque modification.

### Recettes

- Génération par l'API Claude à partir de l'inventaire, avec priorité aux produits qui périment bientôt.
- Filtres : temps disponible, envie (« quelque chose d'asiatique »), nombre de portions.
- Sortie JSON structurée : ingrédients liés aux lignes de l'inventaire, quantités, étapes, temps.
- Valeurs nutritionnelles calculées côté serveur depuis Ciqual et Open Food Facts, pas par le modèle.
- Recettes favorites sauvegardées, recettes perso saisies à la main.

### Suivi alimentation

- Un repas = une recette cuisinée, un produit scanné ou une saisie libre analysée par Claude.
- Chaque repas stocke ses aliments et toutes leurs valeurs nutritionnelles disponibles (affichage détaillé ci-dessous).
- Vue jour et semaine, sans objectif imposé.

### Affichage nutritionnel

Toutes les valeurs disponibles sont affichées, les plus utiles d'abord, chacune avec une courte explication.

1. Toujours visibles : énergie, protéines, glucides (dont sucres), lipides (dont acides gras saturés), fibres, sel.
2. Dépliables : vitamines et minéraux fournis par Ciqual (fer, calcium, magnésium, vitamine C…), les plus courants en premier.

- Chaque valeur a une fiche « À quoi ça sert » de deux ou trois phrases, rédigée une fois à partir des contenus de l'Anses et de Manger Bouger, pas générée à la volée.
- Pas de code couleur rouge ou vert ni de jugement sur les totaux, comme pour le compagnon.
- Une valeur absente de la source s'affiche « non renseignée », jamais estimée.

### Suivi sport et poids

- Séances : type, durée, intensité ressentie, notes.
- Import automatique depuis Health Connect (Android) en phase 4.
- Pesées manuelles ou importées, affichées en tendance lissée plutôt qu'au jour le jour.

### Compagnon et MCP

- Un personnage animé qui réagit aux habitudes et sert de visage au chat dans l'app (détails plus bas).
- Toutes les actions ci-dessus sont aussi disponibles comme tools MCP, utilisables depuis Claude sur web, desktop et mobile.

## Architecture technique

Une seule base Supabase sert l'app et Claude : toute la logique métier vit dans Postgres et les Edge Functions, en TypeScript de bout en bout.

```
Téléphone (Health Connect) ──► App Expo ──┐
                                          ├──► Supabase (Postgres + RLS, Auth, Edge Functions)
Claude (web/desktop/mobile) ──► MCP ──────┘          │
                                                     ├──► API Anthropic (recettes, saisies libres, chat)
                                                     ├──► Open Food Facts (codes-barres)
                                                     └──► Notion (export lecture seule)
Ciqual ──(import unique)──► food_ref
```

Health Connect alimente l'app sur le téléphone ; l'app et Claude écrivent dans la même base ; seules les Edge Functions parlent aux services externes, à part l'import Ciqual fait une fois.

| Brique | Choix | Pourquoi |
|---|---|---|
| App | Expo (React Native), Android puis build web en PWA | Même langage que le backend et le MCP ; builds Android dans le cloud via EAS |
| Backend | Supabase : Postgres, Auth, Edge Functions | Données relationnelles, RLS, serveur OAuth 2.1 compatible MCP |
| Serveur MCP | SDK MCP TypeScript officiel, Streamable HTTP | Même code métier et mêmes schémas Zod que l'app |
| Recettes | API Claude, sortie JSON structurée | Gère les ingrédients atypiques, répond en français |
| Nutrition | Ciqual (import) + Open Food Facts (à la demande) | Référence française en open data + produits emballés |
| Santé | react-native-health-connect | Intégration Expo incluse depuis la v4 |
| Compagnon | Rive | Machine à états pilotée par l'app |
| Notion | Export à sens unique via Edge Function | Garder une vue Notion sans en dépendre |
| Hors-ligne | PowerSync, seulement si le besoin apparaît | Se branche sur Supabase sans changer le schéma |

## Modèle de données

Dix tables Postgres, toutes filtrées par `user_id` via RLS. Le référentiel nutritionnel est partagé et en lecture seule.

| Table | Rôle | Colonnes clés |
|---|---|---|
| `food_ref` | Référentiel nutritionnel (import Ciqual + produits Open Food Facts mis en cache) | source (ciqual, off), code (code Ciqual ou EAN), nom, valeurs pour 100 g (colonnes dédiées pour énergie, protéines, glucides, sucres, lipides, AG saturés, fibres, sel ; vitamines et minéraux en jsonb), poids moyen d'une pièce en g |
| `inventory_item` | Ce qu'il y a dans la cuisine | nom, food_ref_id, catégorie, emplacement, quantité, unité, niveau, péremption, seuil de rachat |
| `stock_movement` | Historique de chaque variation de stock | inventory_item_id, delta, motif (achat, cuisiné, manuel, périmé), meal_id |
| `recipe` | Recettes générées ou saisies | titre, origine (générée, manuelle), portions, temps, étapes (jsonb), favori |
| `recipe_ingredient` | Lignes d'une recette | recipe_id, food_ref_id, inventory_item_id, quantité, unité |
| `meal` | Un repas pris | date-heure, recipe_id, libellé, totaux nutritionnels (jsonb) |
| `meal_item` | Aliments d'un repas | meal_id, food_ref_id, quantité en g |
| `workout` | Séance de sport | début, type, durée en min, intensité ressentie 1–5, source (manuel, Health Connect), id externe |
| `body_measure` | Pesées | date-heure, poids en kg, source |
| `companion_event` | Journal de ce qui fait réagir le compagnon | type, date-heure, données (jsonb) |

L'action « J'ai cuisiné » est une fonction Postgres `cook_recipe(recipe_id, portions)` appelée en RPC. Dans une seule transaction, elle crée le `meal`, ses `meal_item`, les `stock_movement` négatifs et un `companion_event`. Rien ne peut rester à moitié fait.

Les unités hétérogènes (pièce, cuillère, niveau approximatif) sont converties en grammes via le poids moyen stocké dans `food_ref`. Quand la conversion est impossible, le repas est enregistré avec un indicateur « valeurs partielles » plutôt qu'un chiffre inventé.

Les identifiants externes (`workout.id externe`, code EAN) ont une contrainte d'unicité pour que les imports santé et les scans soient idempotents.

## Serveur MCP

Dix tools, hébergés dans une Edge Function Supabase avec le SDK MCP TypeScript officiel en Streamable HTTP. Chaque tool appelle les mêmes fonctions métier que l'app et valide ses entrées avec les mêmes schémas Zod.

| Tool | Ce qu'il fait | Paramètres |
|---|---|---|
| `get_inventory` | Liste le stock, filtrable | catégorie, emplacement, stock bas uniquement |
| `add_items` | Ajoute un ou plusieurs articles (ticket de caisse, courses dictées) | liste de {nom, quantité, unité, emplacement, péremption} |
| `update_item` | Corrige une quantité, un niveau ou une date | id, champs à modifier |
| `get_shopping_list` | Articles sous leur seuil de rachat | aucun |
| `suggest_recipes` | Propose des recettes depuis le stock | temps max, envie, portions |
| `cook_recipe` | Déclenche « J'ai cuisiné » | recipe_id, portions |
| `log_meal` | Enregistre un repas hors recette | description libre ou liste d'aliments, date-heure |
| `log_workout` | Enregistre une séance | type, durée, intensité, date-heure |
| `log_weight` | Enregistre une pesée | poids en kg, date-heure |
| `get_summary` | Résumé du jour ou de la semaine | période |

Règles de conception des tools :

- Chaque `log_*` accepte une clé d'idempotence, pour qu'un appel rejoué par Claude ne crée pas de doublon.
- Les réponses sont courtes et structurées (ce qui a été créé, ce qui reste ambigu) pour que Claude puisse confirmer en une phrase.
- Quand un aliment ne trouve pas de correspondance dans `food_ref`, le tool renvoie les candidats les plus proches au lieu de deviner.

Authentification, en deux temps :

1. Phase 1 : une clé API envoyée en en-tête fixe, configurée dans le connecteur personnalisé de Claude. Suffisant pour un usage solo.
2. Phase 3 : le serveur OAuth 2.1 de Supabase Auth, avec enregistrement dynamique des clients. Claude agit alors en tant que l'utilisateur et la RLS s'applique.

Le connecteur fonctionne aussi dans les apps Claude iOS et Android : on peut logger un repas à la voix sans ouvrir l'app. Alternative d'hébergement si les Edge Functions posent problème : Cloudflare Workers, qui gère les tokens OAuth nativement.

## Le compagnon

Un petit personnage animé avec Rive, dont l'humeur dépend des habitudes en cuisine et de l'état du stock, jamais du corps. Proposition ci-dessous : Miso, à valider.

### Proposition : Miso

- Nom : Miso. Court, facile à dire à Claude, et dans le ton d'un stock qui penche vers les sauces japonaises (soja, yuzu, teriyaki).
- Apparence : un petit onigiri tout rond, une bande de nori nouée en écharpe, deux yeux en points et des joues roses. Une forme simple, facile à animer dans Rive.
- Expressions : l'écharpe de nori porte l'humeur ; elle flotte quand il est content et retombe quand il somnole. Un grain de riz tombe quand il a faim.
- Voix : tutoie, phrases courtes, taquin sur la cuisine et jamais sur la personne. Par exemple : « Encore du riz ? Je ne juge pas. Enfin, un peu. » ou « Tes mangues au congélo s'ennuient. Smoothie ? »
- Alternatives si Miso ne plaît pas : Yuzu, un petit agrume pétillant, ou Pesto, une feuille de basilic ronchon mais gentil.

La machine à états Rive reçoit trois entrées depuis l'app : `mood` (nombre), `hunger` (nombre) et des déclencheurs ponctuels (`celebrate`, `wave`). Le calcul de ces valeurs se fait côté serveur à partir de `companion_event` et de l'inventaire.

| État | Déclencheur | Réaction |
|---|---|---|
| Repos | Par défaut | Animation idle, cligne des yeux |
| Content | Un repas cuisiné aujourd'hui, ou trois jours de suivi d'affilée | Sourire, petite danse à l'ouverture |
| Affamé | Plusieurs articles sous leur seuil de rachat | Ventre qui gargouille, pointe la liste de courses |
| Inquiet | Un produit périme dans les 48 h | Montre le produit, propose une recette qui l'utilise |
| Fête | Première fois qu'une recette est cuisinée, série de sept jours | Confettis, déclencheur `celebrate` |
| Somnolent | Plusieurs jours sans ouverture | Dort, se réveille joyeux au retour, sans reproche |

Règles de ton, valables dans l'app et dans son chat :

- Aucun commentaire sur une variation de poids, une quantité mangée ou un total calorique, ni positif ni négatif.
- Une série interrompue ne déclenche aucune pénalité ni tristesse ; le compagnon repart simplement de zéro, content.
- Pas de notification culpabilisante ; les rappels portent sur le stock (un produit qui périme), pas sur la personne.
- L'humour vise la cuisine (« encore du riz ? »), jamais l'utilisateur.

Dans l'app, le compagnon est aussi le visage du chat. Le chat appelle l'API Claude avec un prompt système qui fixe sa personnalité et ces règles, et lui donne accès aux mêmes fonctions que les tools MCP.

## Écrans et parcours

Quatre onglets sur mobile, les mêmes écrans en colonnes sur desktop (build web d'Expo, installé en PWA). Le chat s'ouvre en touchant le compagnon, depuis n'importe quel écran.

| Onglet | Contenu |
|---|---|
| Accueil | Compagnon, résumé du jour, produits qui périment, bouton « Qu'est-ce que je mange ? » |
| Cuisine | Inventaire par emplacement, scan, liste « À racheter » |
| Recettes | Génération depuis le stock, favoris, recettes perso |
| Journal | Repas, séances et pesées sur une frise par jour, tendances par semaine |

Parcours « cuisiner avec ce qu'on a » :

1. Accueil → « Qu'est-ce que je mange ? », avec un filtre de temps optionnel.
2. Trois recettes proposées, celles qui utilisent un produit proche de la péremption en premier.
3. Fiche recette avec les ingrédients cochés comme disponibles.
4. « J'ai cuisiné », choix du nombre de portions mangées.
5. Stock décrémenté, repas ajouté au journal, compagnon content.

Parcours « ranger les courses » :

1. Cuisine → Scanner, caméra en mode continu.
2. Chaque code-barres reconnu s'ajoute à une liste temporaire avec emplacement suggéré.
3. Les produits sans code-barres (fruits, légumes) se dictent ou se tapent, rapprochés de Ciqual.
4. Validation en un geste ; les articles qui étaient « À racheter » en sortent.

Parcours « tout via Claude » :

1. Dans Claude (web, desktop ou mobile) : « ce midi riz sauce teriyaki avec deux œufs, et 40 min de vélo ce soir ».
2. Claude appelle `log_meal` puis `log_workout`, et demande une précision seulement si un aliment est ambigu.
3. L'app reflète les entrées au prochain affichage.

## Sécurité et données de santé

Repas, séances et poids sont des données de santé au sens du RGPD : on les traite comme sensibles dès la V1, même en usage solo.

| Service | Ce qu'il reçoit | Pourquoi |
|---|---|---|
| Supabase (région UE) | Toutes les données | Hébergement de la base, auth, fichiers |
| API Anthropic | Inventaire, descriptions de repas, messages du chat | Génération de recettes, analyse des saisies libres, chat du compagnon |
| Open Food Facts | Codes-barres uniquement | Fiche produit |
| Notion | Inventaire et liste « À racheter » uniquement | Export en lecture seule ; aucune donnée de santé |
| Health Connect | Rien n'est envoyé ; lecture seule | Import des séances et pesées |

Mesures :

- RLS activée sur chaque table ; la clé `service_role` ne sort jamais du serveur.
- Permissions santé minimales : lecture des séances et du poids uniquement, rien d'autre.
- Clé API du connecteur MCP stockée hachée, révocable et remplaçable depuis les réglages.
- Aucun contenu de repas ni de poids dans les logs des Edge Functions, seulement des identifiants et des codes d'erreur.
- Une fonction d'export complet (JSON) et une de suppression totale du compte, dès la phase 2.

## Roadmap

Cinq phases sans dates fixées : le MCP arrive en premier pour valider le modèle de données en usage réel, le compagnon en dernier.

| Phase | Nom | Contenu | Critère de fin |
|---|---|---|---|
| 1 | Fondations | Schéma + RLS, import Ciqual, import Notion, serveur MCP, clé API | Une semaine de suivi via Claude seul |
| 2 | App de base | Expo Android, inventaire, scan OFF, journal, export Notion, export données | Courses rangées par scan |
| 3 | Recettes | Génération, « J'ai cuisiné », fiches nutrition, OAuth Supabase | Stock juste sans retouche |
| 4 | Santé | Health Connect, build EAS, tendance poids | Imports sans doublon |
| 5 | Compagnon | Miso en Rive, six états, chat in-app | Six états déclenchés |

Une phase démarre quand le critère de la précédente est rempli. Un compagnon provisoire très simple occupe l'écran d'accueil dès la phase 2.

## Risques et questions ouvertes

Le risque principal n'est pas technique : c'est d'arrêter de saisir au bout de deux semaines. D'où le choix de livrer le MCP avant l'interface.

| Risque | Parade |
|---|---|
| Abandon de la saisie | MCP dès la phase 1, scan en continu, saisie en une phrase |
| Conversions d'unités imprécises (pièce, cuillère, « moitié ») | Poids moyen par aliment, indicateur « valeurs partielles » au lieu d'un chiffre inventé |
| Auth MCP pas encore intégrée aux Edge Functions Supabase | Clé API en en-tête en attendant, Cloudflare Workers en repli |
| Connecteurs personnalisés instables côté Claude (incidents signalés en 2026) | Tester aussi le serveur avec Claude Code et l'inspecteur MCP |
| Modules santé incompatibles avec Expo Go | Development build EAS dès la phase 4 |
| Personnage Rive long à dessiner | Placeholder simple en phase 2, personnage final en phase 5 |

Décisions prises :

- Plateforme : Android. L'import santé passe par Health Connect, sans compte développeur Apple ; un build iOS reste possible plus tard.
- Compagnon : proposition Miso (section Le compagnon), à valider.
- Notion : export à sens unique en lecture seule, limité à l'inventaire et à la liste « À racheter ».
- Nutrition : toutes les valeurs, les principales d'abord, avec une explication par valeur.

## Références

- Table Ciqual, Anses (mise à jour du 19/11/2025)
- Supabase — authentification MCP avec le serveur OAuth 2.1
- Supabase — déployer un serveur MCP sur Edge Functions
- Claude — connecteurs personnalisés via MCP distant
- react-native-health-connect — intégration Expo
- PowerSync + Supabase
