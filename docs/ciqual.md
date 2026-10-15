# Import Ciqual

Référentiel nutritionnel de `food_ref` (`source = 'ciqual'`), importé une fois depuis la table Ciqual de l'Anses.

- **Source** : [Table de composition nutritionnelle des aliments Ciqual 2025](https://doi.org/10.57745/RDMHWY), version du 03/11/2025 publiée le 19/11/2025, licence Etalab 2.0. 3 484 aliments.
- **Fichiers** : le format XML (`alim_*.xml`, `const_*.xml`, `compo_*.xml`), pas le XLSX : les constituants y sont identifiés par un `const_code` numérique stable, alors que les en-têtes de colonnes du XLSX changent d'une version à l'autre.
- **Code** : parsing dans [`scripts/src/ciqual.ts`](../scripts/src/ciqual.ts), import dans [`scripts/src/import-ciqual.ts`](../scripts/src/import-ciqual.ts).

## Lancer l'import

```bash
# Télécharger alim_*.xml, const_*.xml et compo_*.xml dans un dossier, puis :
pnpm import:ciqual ~/Téléchargements/ciqual-2025 --dry-run   # lecture seule, affiche le décompte
pnpm import:ciqual ~/Téléchargements/ciqual-2025             # écrit dans food_ref
```

Variables requises (`.env` à la racine, ou environnement) : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. L'import est idempotent (upsert sur `(source, code)`) et n'écrase pas `piece_weight_g`.

## Valeurs particulières

| Teneur Ciqual | Signification | Stockée comme |
|---|---|---|
| `12,3` | valeur mesurée | `12.3` |
| `-` | non mesurée | `null` |
| `traces` | présence non quantifiable | `null` |
| `< 0,5` | sous le seuil de quantification | `null` |
| autre format | inconnu | **erreur** : l'import s'arrête plutôt que de deviner |

`null` (colonnes) ou clé absente (`micronutrients`) s'affichent « non renseignée ». Jamais 0, jamais d'estimation.

## Colonnes principales (pour 100 g)

| Colonne | `const_code` | Constituant Ciqual |
|---|---|---|
| `energy_kcal` | 328 | Énergie, règlement UE 1169/2011 (kcal) |
| `protein_g` | 25003 | Protéines, N × 6,25 |
| `carbs_g` | 31000 | Glucides |
| `sugars_g` | 32000 | Sucres |
| `fat_g` | 40000 | Lipides |
| `saturated_fat_g` | 40302 | AG saturés |
| `fiber_g` | 34100 | Fibres alimentaires |
| `salt_g` | 10004 | Sel chlorure de sodium |

Protéines en **N × 6,25** plutôt qu'avec le facteur de Jones : c'est la base du règlement UE 1169/2011, donc cohérente avec l'énergie retenue et avec les étiquettes des produits Open Food Facts que l'on additionnera aux aliments Ciqual.

## Clés de `micronutrients`

Définies dans [`packages/core/src/nutrients.ts`](../packages/core/src/nutrients.ts), dans l'ordre d'affichage. Le suffixe donne l'unité. **Ne jamais renommer une clé** : elle est stockée telle quelle en base.

| Clé | `const_code` | Constituant Ciqual |
|---|---|---|
| `iron_mg` | 10260 | Fer |
| `calcium_mg` | 10200 | Calcium |
| `magnesium_mg` | 10120 | Magnésium |
| `vitamin_c_mg` | 55100 | Vitamine C |
| `potassium_mg` | 10190 | Potassium |
| `vitamin_d_ug` | 52100 | Vitamine D |
| `vitamin_b12_ug` | 56600 | Vitamine B12 |
| `vitamin_b9_ug` | 56700 | Vitamine B9, folates totaux |
| `zinc_mg` | 10300 | Zinc |
| `vitamin_a_ug` | 51104 | Activité vitaminique A, équivalents rétinol |
| `vitamin_e_mg` | 53100 | Vitamine E |
| `vitamin_b1_mg` | 56100 | Vitamine B1, thiamine |
| `vitamin_b2_mg` | 56200 | Vitamine B2, riboflavine |
| `vitamin_b3_mg` | 56310 | Vitamine B3, niacine |
| `vitamin_b5_mg` | 56400 | Vitamine B5, acide pantothénique |
| `vitamin_b6_mg` | 56500 | Vitamine B6 |
| `vitamin_k1_ug` | 54101 | Vitamine K1 |
| `vitamin_k2_ug` | 54104 | Vitamine K2 |
| `phosphorus_mg` | 10150 | Phosphore |
| `iodine_ug` | 10530 | Iode |
| `selenium_ug` | 10340 | Sélénium |
| `copper_mg` | 10290 | Cuivre |
| `manganese_mg` | 10251 | Manganèse |
| `chloride_mg` | 10170 | Chlorure |

Non importés : eau, cendres, alcool, acides organiques, polyols, amidon, sucres et acides gras détaillés, cholestérol, formes détaillées des vitamines D, E, A et B9.

## Garde-fou

Avant d'importer, le script vérifie dans `const_*.xml` que chaque `const_code` utilisé existe et porte l'unité attendue (`(mg/100 g)`…). Si l'Anses renumérote ou change une unité dans une future version, l'import échoue au lieu d'écrire des valeurs fausses.
