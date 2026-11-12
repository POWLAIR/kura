# Open Food Facts

Les produits emballés viennent d'[Open Food Facts](https://world.openfoodfacts.org) (OFF), par leur code-barres. La fonction `off-product` (`supabase/functions/off-product/`) interroge OFF une fois par produit, puis le garde dans `food_ref` (`source = 'off'`, `code` = code-barres) : c'est le cache, partagé comme le reste du référentiel.

## Appel

`POST /functions/v1/off-product`, corps `{ "ean": "3017620422003" }`, avec la session de l'utilisateur (même authentification et même CORS que l'API de l'app, voir `docs/api.md`).

```ts
const { data } = await supabase.functions.invoke("off-product", { body: { ean } });
```

| Réponse | Sens |
|---|---|
| 200 `{ found: true, cached, food }` | Le produit, tel qu'il est dans `food_ref`. `cached: true` : aucune requête n'est partie vers OFF |
| 200 `{ found: false, ean }` | Code inconnu d'OFF, ou fiche sans nom : l'article se saisit à la main |
| 400 `invalid_input` | Ce n'est pas un code-barres |
| 401, 403 | Session ou origine refusée |
| 502 `off_unavailable` | OFF ne répond pas (délai de 8 s) ; rien n'est mis en cache |

Un code inconnu n'est pas mis en cache : le produit peut être ajouté à OFF plus tard.

## Code-barres

Le schéma `Ean` (`packages/core/src/off.ts`) accepte 8, 12, 13 ou 14 chiffres et vérifie la clé de contrôle : un code mal lu par la caméra est refusé avant toute requête. Un UPC-A (12 chiffres) est complété en EAN-13 par un zéro, puisque les lecteurs renvoient l'un ou l'autre selon l'appareil.

## Ce qui part vers Open Food Facts

Seulement le code-barres, dans l'URL, et un `User-Agent` qui identifie l'app comme le demande leur API. Ni jeton, ni identifiant de l'utilisateur, ni contenu (testé).

Le `User-Agent` par défaut est `Kura/0.1 (app personnelle)`. OFF recommande d'y mettre un contact ; pour le faire :

```bash
pnpm exec supabase secrets set KURA_OFF_USER_AGENT="Kura/0.1 (<contact>)"
```

## Écriture dans `food_ref`

`food_ref` est en lecture seule pour les utilisateurs (RLS, droit `select` uniquement). La fonction y écrit par sa connexion Postgres directe, comme l'import Ciqual le fait avec la clé secrète : elle est la seule à écrire des produits OFF. Deux scans simultanés du même produit n'écrivent qu'une ligne (`unique (source, code)`).

## Correspondance des champs

Faite par `mapOffProduct` (`packages/core/src/off.ts`), testée sur une réponse réelle.

**Règle : seules les valeurs déclarées sont reprises.** OFF renvoie aussi `nutriments_estimated`, des valeurs qu'il calcule depuis la liste d'ingrédients : elles ne sont jamais lues. Une valeur absente reste `null` (colonnes) ou sans clé (`micronutrients`, `nutrient_details`), donc « non renseignée ».

| `food_ref` | Champ OFF | Remarque |
|---|---|---|
| `code` | le code-barres demandé | |
| `name` | `product_name_fr`, sinon `product_name`, sinon `generic_name_fr` | Aucun des trois : produit traité comme inconnu |
| `brand` | `brands` | |
| `package_quantity`, `package_unit` | `product_quantity`, `product_quantity_unit` | Seulement en g ou en ml ; sert à proposer une quantité au scan |
| `per_100_unit` | `product_quantity_unit`, sinon `serving_quantity_unit` ; `null` si aucun ne vaut `g` ou `ml` | Voir « Base des valeurs » |
| `energy_kcal` | `nutriments.energy-kcal_100g` | Les kJ ne sont pas convertis |
| `protein_g` | `proteins_100g` | |
| `carbs_g` | `carbohydrates_100g` | |
| `sugars_g` | `sugars_100g` | |
| `fat_g` | `fat_100g` | |
| `saturated_fat_g` | `saturated-fat_100g` | |
| `fiber_g` | `fiber_100g` | |
| `salt_g` | `salt_100g` | |
| `piece_weight_g` | — | Jamais rempli : le poids d'une pièce vient de l'utilisateur (`set_food_conversion`) |

Vitamines, minéraux et détails : dans `nutriments`, `<id>_100g` est exprimé en grammes ; la valeur est convertie dans l'unité de notre clé (× 1 000 pour des mg, × 1 000 000 pour des µg). Les tables `OFF_MICRONUTRIENTS` et `OFF_DETAILS` donnent chaque correspondance (`iron` → `iron_mg`, `vitamin-pp` → `vitamin_b3_mg`, `phylloquinone` → `vitamin_k1_ug`, `eicosapentaenoic-acid` → `epa_g`…). Un test vérifie que chaque facteur correspond au suffixe de la clé.

Non repris :
- `alcohol` : c'est un pourcentage en volume chez OFF, pas des grammes ;
- `vitamin-k` sans précision K1 ou K2 ;
- l'eau, absente des étiquettes.

## Base des valeurs : 100 g, 100 ml ou inconnue

Pour une boisson, les valeurs d'OFF sont pour 100 ml, pas pour 100 g. `food_ref.per_100_unit` le dit, et les totaux d'un repas en tiennent compte (`nutrition_amount`, voir `docs/mcp.md`).

| `per_100_unit` | Quand | Dans les totaux d'un repas |
|---|---|---|
| `g` | `product_quantity_unit` vaut `g`, sinon `serving_quantity_unit` vaut `g` ; toujours pour Ciqual | La quantité en grammes |
| `ml` | L'un de ces deux champs vaut `ml` | Une quantité dite en ml est comptée telle quelle ; dite en g ou en pièces, il faut la densité donnée par l'utilisateur |
| `null` | La fiche n'a ni contenance ni portion exploitable | Jamais compté : le repas est « valeurs partielles » |

La base n'est jamais supposée : une fiche qui ne dit pas si le produit se vend au poids ou au volume donne un aliment non compté, plutôt qu'un chiffre faux.

## Limites

- **Base inconnue.** Un produit dont la fiche OFF n'a ni contenance ni portion reste non compté, et l'app ne permet pas encore de préciser sa base à la main.
- **Champs demandés.** `quantity` figure dans la liste des champs alors qu'il n'est pas lu : sans lui, OFF ne renvoie pas `product_quantity` quand `nutriments` est demandé (constaté le 2026-11-12).

## Tests

- `packages/core/src/off.test.ts` (Vitest) : code-barres, URL, correspondance des champs sur une réponse réelle, valeurs estimées ignorées, conversions d'unités.
- `supabase/functions/off-product/handler_test.ts` (Deno, avec un faux OFF) : refus sans session, code invalide, premier scan, cache, produit inconnu, OFF en panne, rien de sensible dans les logs.
- `supabase/tests/off_product_test.sql` (pgTAP) : contraintes des colonnes, lecture seule pour les utilisateurs.
- `supabase/tests/per_100_ml_test.sql` (pgTAP) : totaux pour 100 g, pour 100 ml (en ml, en g avec et sans densité) et base inconnue.
