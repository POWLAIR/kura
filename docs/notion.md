# Import Notion

Import unique de la page Notion « Inventaire des ingrédients » dans `inventory_item`, avec un `stock_movement` motif `achat` par article. L'export vers Notion (phase 2) est un autre sujet.

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

Un lien faux donnerait des valeurs nutritionnelles fausses. Le rapprochement automatique est donc prudent : il ne lie un article que si un seul aliment correspond, sans tenir compte des accents ni du pluriel. L'aliment doit avoir exactement le même nom (« Moutarde »), ou être le seul de ce nom avant la virgule (« Cannelle » donne « Cannelle, poudre »).

Sinon, l'article est importé avec `food_ref_id = null` et listé en fin de rapport avec les trois candidats les plus proches.

`--choices` fixe les cas restants : nom de l'article → code Ciqual, ou `null` quand aucun aliment ne correspond (sauce de marque, plat fait maison). Un nom absent de la page ou un code inconnu arrêtent l'import. Principes suivis dans `notion-choices.json` :

- forme crue pour les produits bruts (riz, œufs, pomme de terre) ;
- forme séchée pour les herbes rangées au placard ;
- `null` plutôt qu'un aliment approchant.

## Mouvement « achat »

Chaque article reçoit un `stock_movement` motif `achat` dont le `delta` vaut :

- la quantité, pour un article chiffré (12 pour une douzaine d'œufs) ;
- la fraction d'un contenant plein, pour un article en niveau (`STOCK_LEVEL_FRACTION` de `@kura/core` : plein 1, moitié 0,5, presque vide 0,25).
