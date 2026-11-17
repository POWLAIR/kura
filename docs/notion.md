# Notion

Deux usages, dans des sens opposés :

- **Import** (une fois, phase 1) : la page Notion « Inventaire des ingrédients » vers `inventory_item`. Voir ci-dessous.
- **Export** (phase 2) : l'inventaire vers une base Notion en lecture seule, tenue à jour. Voir [Export vers Notion](#export-vers-notion).

# Import Notion

Import unique de la page Notion « Inventaire des ingrédients » dans `inventory_item`, avec un `stock_movement` motif `achat` par article.

- **Code** : lecture de la page dans [`scripts/src/notion.ts`](../scripts/src/notion.ts), rapprochement Ciqual dans [`scripts/src/food-match.ts`](../scripts/src/food-match.ts), import dans [`scripts/src/import-notion.ts`](../scripts/src/import-notion.ts).
- **Choix Ciqual** : [`scripts/notion-choices.json`](../scripts/notion-choices.json).

## Lancer l'import

Prérequis :

- `NOTION_TOKEN` dans `.env`, avec la page partagée avec l'intégration (menu ⋯ → Connexions) ;
- `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` ;
- `food_ref` déjà rempli (`pnpm import:ciqual`, voir [ciqual.md](ciqual.md)).

```bash
# Affiche le mapping proposé, n'écrit rien
pnpm import:notion <lien de la page> --dry-run --choices scripts/notion-choices.json

# Écrit dans l'inventaire de l'utilisateur (compte Supabase Auth existant)
pnpm import:notion <lien de la page> --user <email> --choices scripts/notion-choices.json
```

L'import refuse d'écrire si l'inventaire de l'utilisateur n'est pas vide, pour ne pas créer de doublons. En cas d'erreur en cours de route, les articles déjà créés sont supprimés, ainsi que leurs mouvements.

## Lecture de la page

Chaque titre ouvre une section, et chaque puce (liste à puces, numérotée ou à cocher) donne un article. Le texte libre et les séparateurs sont ignorés. Une liste imbriquée, un bloc d'un autre type ou une section inconnue arrêtent l'import : le script ne devine pas.

| Titre contenant | Catégorie | Emplacement par défaut |
|---|---|---|
| épice, herbe | `epices` | placard |
| féculent | `feculents` | placard |
| sauce, condiment | `sauces` | placard |
| fait maison | `fait_maison` | frigo |
| frigo, congel, frais | `frais` | frigo |
| à racheter | ignorée : articles absents du stock | — |

Les indications entre parenthèses en fin de puce sont lues une à une. Une indication non reconnue reste dans le nom, par exemple « Lasagnes (feuilles sèches) ».

| Indication | Résultat |
|---|---|
| `placard`, `frigo`, `congélateur`, `surgelé` | emplacement |
| `2`, `1,5 kg`, `50 cl`, `250 g` | quantité (pièces sans unité, conversion en g ou ml) |
| `une douzaine`, `demi-douzaine` | 12 ou 6 pièces |
| `grande quantité`, `plusieurs`, `plein` | niveau plein |
| `moitié`, `presque vide`, `bientôt fini` | niveau correspondant |
| rien | niveau plein **supposé**, marqué `*` dans le rapport |

Pour corriger une déduction, ajoute l'indication dans Notion (par exemple « Pesto vert (frigo) ») puis relance le `--dry-run`.

## Rapprochement avec Ciqual

Un lien faux donnerait des valeurs nutritionnelles fausses. Le rapprochement automatique est donc prudent : il ne lie un article que si un seul aliment correspond, sans tenir compte des accents ni du pluriel. L'aliment doit avoir exactement le même nom (« Moutarde »), ou être le seul de ce nom avant la virgule sans variante qui commence par ce nom (« Cannelle » donne « Cannelle, poudre », mais « Riz » reste ambigu : riz blanc, thaï, complet…). La règle vit dans `packages/core/src/food-match.ts`, partagée avec le serveur MCP.

Sinon, l'article est importé avec `food_ref_id = null` et listé en fin de rapport avec les trois candidats les plus proches.

`--choices` fixe les cas restants : nom de l'article → code Ciqual, ou `null` quand aucun aliment ne correspond (sauce de marque, plat fait maison). Un nom absent de la page ou un code inconnu arrêtent l'import. Principes suivis dans `notion-choices.json` :

- forme crue pour les produits bruts (riz, œufs, pomme de terre) ;
- forme séchée pour les herbes rangées au placard ;
- `null` plutôt qu'un aliment approchant.

## Mouvement « achat »

Chaque article reçoit un `stock_movement` motif `achat` dont le `delta` vaut :

- la quantité, pour un article chiffré (12 pour une douzaine d'œufs) ;
- la fraction d'un contenant plein, pour un article en niveau (`STOCK_LEVEL_FRACTION` de `@kura/core` : plein 1, moitié 0,5, presque vide 0,25).

# Export vers Notion

Une base Notion « Kura · Inventaire », tenue à jour depuis l'inventaire, pour le consulter dans Notion sans dépendre de lui (issue #29).

- **Sens unique** : Kura écrit, Notion ne fait que montrer. Une modification faite dans Notion n'est jamais relue : elle est réécrite au prochain export.
- **Seulement ses propres pages** : l'export ne touche qu'aux pages qui portent un « Kura id ». Une page ajoutée à la main est laissée telle quelle. Avant toute écriture, l'export vérifie que la base a bien les propriétés ci-dessous ; sinon il n'écrit rien (`last_error = notion_schema`).
- **Inventaire seulement** : nom, emplacement, catégorie, quantité ou niveau, date de péremption, « À racheter ». Ni repas, ni séances, ni pesées, ni aliment de référence (testé).

## Propriétés de la base

| Propriété | Type | Contenu |
|---|---|---|
| Nom | titre | nom de l'article |
| Emplacement | sélection | Placard, Frigo, Congélateur |
| Catégorie | sélection | Épices, Féculents, Sauces, Frais, Fait maison |
| Quantité | texte | « 1,5 kg », « 6 pièces », « Moitié » |
| Péremption | date | vide s'il n'y en a pas |
| À racheter | case à cocher | cochée sous le seuil de rachat |
| Kura id | nombre | id de l'article, qui relie la page à l'inventaire : ne pas le modifier |

La liste « À racheter » est une vue de cette base, filtrée sur la case « À racheter ». Elle se crée une fois dans Notion (Ajouter une vue → filtre « À racheter » est coché) : l'API ne crée pas de vues.

## Fonctionnement

1. Un déclencheur sur `inventory_item` compte chaque modification de l'inventaire dans `notion_export.changes`.
2. Toutes les minutes, `pg_cron` appelle `request_notion_export()`. S'il y a des modifications non exportées, et aucune depuis 15 secondes, elle appelle la fonction `notion-export` par `pg_net`, avec un secret partagé. Les modifications rapprochées (courses rangées par scan) partent donc en un seul export.
3. La fonction réserve les exports à faire (`claim_notion_exports`), en une requête : un second appel, si le précédent n'est pas fini, ne réserve pas le même utilisateur, et aucune page n'est créée en double. La réservation est libérée à la fin de l'export, ou reprise après 10 minutes si la fonction s'est arrêtée en route.
4. Pour chaque export réservé, elle vérifie la structure de la base, lit l'inventaire de l'utilisateur sous RLS (la même opération que `get_inventory`) et les pages de la base, puis crée ce qui manque, réécrit ce qui diffère et met à la corbeille les pages d'articles retirés ou en double. Une page à jour n'est pas touchée. Elle marque enfin comme exportées les modifications vues au départ : une modification faite pendant l'export part au suivant.
5. Si Notion refuse (jeton invalide, base non partagée), le code est noté dans `notion_export.last_error` (ex. `notion_401`) et l'export reste à faire : il est retenté chaque minute. Les logs ne contiennent que l'id de l'utilisateur, des nombres de pages et des codes.

Notion limite à environ trois requêtes par seconde : un 429 fait attendre le délai indiqué (`Retry-After`), trois fois au plus.

## Mise en place

Prérequis : une intégration Notion (notion.so/profile/integrations) et son jeton, `NOTION_TOKEN`.

1. Dans Notion, crée une page qui accueillera la base, et partage-la avec l'intégration (⋯ → Connexions).
2. Crée la base et relie-la au compte :

   ```bash
   pnpm notion:setup --user <email> --page <lien de la page>
   ```

   Pour une base qui existe déjà avec les propriétés ci-dessus : `--data-source <id>` au lieu de `--page`. Le script vérifie ses propriétés et refuse une base qui ne les a pas. Relier à nouveau le compte exporte tout l'inventaire.

   La ligne `notion_export` ne s'écrit que par ce script (clé de service) : l'utilisateur peut la lire, ou la supprimer pour arrêter l'export, mais pas choisir lui-même la base où écrit le jeton du serveur.
3. Configure la fonction et la tâche planifiée : voir `docs/deploiement.md` (secrets `NOTION_TOKEN` et `KURA_CRON_SECRET`, deux secrets dans le coffre de la base).

Pour arrêter l'export : supprimer la ligne de l'utilisateur dans `notion_export`. La base Notion reste telle quelle.

## Tests

- `packages/core/src/notion-export.test.ts` : propriétés envoyées (inventaire seulement), relecture d'une page, plan d'export (créer, réécrire, corbeille, doublons, pages ajoutées à la main).
- `supabase/tests/notion_export_test.sql` : droits de l'utilisateur (lecture et suppression seulement), modifications comptées pour leur seul propriétaire, attente de la fin d'une rafale, réservation exclusive et reprise d'une réservation abandonnée, modification arrivée pendant un export.
- `supabase/functions/notion-export/handler_test.ts`, avec un faux Notion qui répond comme l'API : refus sans le secret, pagination et 429, export complet puis mises à jour, corbeille, page sans « Kura id » jamais touchée, deux appels simultanés sans page en double, base sans les bonnes propriétés laissée intacte, aucune donnée de santé envoyée, erreur de Notion notée sans contenu dans les logs.

