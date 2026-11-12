import { z } from "zod";
import type { MainNutrientKey, MicronutrientKey, NutrientDetailKey } from "./nutrients.ts";

// Open Food Facts : code-barres et correspondance des champs d'un produit vers food_ref.
// Voir docs/open-food-facts.md. Règle : seules les valeurs déclarées (`nutriments`) sont
// reprises ; jamais `nutriments_estimated`, qu'OFF calcule depuis les ingrédients.

// ---------------------------------------------------------------------------
// Code-barres
// ---------------------------------------------------------------------------

// Clé de contrôle GTIN : pondération 3-1 depuis la droite, hors dernier chiffre.
function hasValidCheckDigit(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

// Code-barres d'un produit : EAN-8, UPC-A (12 chiffres), EAN-13 ou GTIN-14, clé de contrôle
// vérifiée. Un UPC-A est complété en EAN-13 par un zéro : c'est le même produit, et les
// lecteurs renvoient l'un ou l'autre selon l'appareil.
export const Ean = z
  .string()
  .trim()
  .regex(/^(\d{8}|\d{12,14})$/, "Code-barres attendu : 8, 12, 13 ou 14 chiffres")
  .refine(hasValidCheckDigit, "Code-barres invalide : clé de contrôle incorrecte")
  .transform((digits) => (digits.length === 12 ? `0${digits}` : digits));
export type Ean = z.infer<typeof Ean>;

export const OffProductInput = z.object({ ean: Ean });
export type OffProductInput = z.infer<typeof OffProductInput>;

// ---------------------------------------------------------------------------
// Requête : seul le code-barres part vers Open Food Facts
// ---------------------------------------------------------------------------

const OFF_FIELDS = [
  "code",
  "product_name_fr",
  "product_name",
  "generic_name_fr",
  "brands",
  // Sans « quantity », OFF ne renvoie pas product_quantity quand nutriments est demandé
  // (constaté le 2026-11-12).
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "nutriments",
] as const;

export function offProductUrl(ean: Ean): string {
  return `https://world.openfoodfacts.org/api/v2/product/${ean}?fields=${OFF_FIELDS.join(",")}`;
}

// ---------------------------------------------------------------------------
// Correspondance des champs
// ---------------------------------------------------------------------------

// Dans `nutriments`, « <id>_100g » est exprimé en grammes pour 100 g ou 100 ml (en kcal pour
// l'énergie). `factor` convertit vers l'unité de notre clé : 1 000 pour des mg, 1 000 000
// pour des µg.
const G = 1;
const MG = 1_000;
const UG = 1_000_000;

export const OFF_MAIN: Record<string, MainNutrientKey> = {
  "energy-kcal": "energy_kcal",
  proteins: "protein_g",
  carbohydrates: "carbs_g",
  sugars: "sugars_g",
  fat: "fat_g",
  "saturated-fat": "saturated_fat_g",
  fiber: "fiber_g",
  salt: "salt_g",
};

export const OFF_MICRONUTRIENTS: Record<string, { key: MicronutrientKey; factor: number }> = {
  iron: { key: "iron_mg", factor: MG },
  calcium: { key: "calcium_mg", factor: MG },
  magnesium: { key: "magnesium_mg", factor: MG },
  "vitamin-c": { key: "vitamin_c_mg", factor: MG },
  potassium: { key: "potassium_mg", factor: MG },
  "vitamin-d": { key: "vitamin_d_ug", factor: UG },
  "vitamin-b12": { key: "vitamin_b12_ug", factor: UG },
  "vitamin-b9": { key: "vitamin_b9_ug", factor: UG },
  zinc: { key: "zinc_mg", factor: MG },
  "vitamin-a": { key: "vitamin_a_ug", factor: UG },
  "vitamin-e": { key: "vitamin_e_mg", factor: MG },
  "vitamin-b1": { key: "vitamin_b1_mg", factor: MG },
  "vitamin-b2": { key: "vitamin_b2_mg", factor: MG },
  "vitamin-pp": { key: "vitamin_b3_mg", factor: MG },
  "pantothenic-acid": { key: "vitamin_b5_mg", factor: MG },
  "vitamin-b6": { key: "vitamin_b6_mg", factor: MG },
  // « vitamin-k » (sans précision K1 ou K2) n'est pas repris.
  phylloquinone: { key: "vitamin_k1_ug", factor: UG },
  phosphorus: { key: "phosphorus_mg", factor: MG },
  iodine: { key: "iodine_ug", factor: UG },
  selenium: { key: "selenium_ug", factor: UG },
  copper: { key: "copper_mg", factor: MG },
  manganese: { key: "manganese_mg", factor: MG },
  chloride: { key: "chloride_mg", factor: MG },
};

// « alcohol » est un pourcentage en volume chez OFF, pas des grammes : non repris, comme
// l'eau, absente des étiquettes.
export const OFF_DETAILS: Record<string, { key: NutrientDetailKey; factor: number }> = {
  starch: { key: "starch_g", factor: G },
  sucrose: { key: "sucrose_g", factor: G },
  glucose: { key: "glucose_g", factor: G },
  fructose: { key: "fructose_g", factor: G },
  lactose: { key: "lactose_g", factor: G },
  maltose: { key: "maltose_g", factor: G },
  galactose: { key: "galactose_g", factor: G },
  "monounsaturated-fat": { key: "monounsaturated_fat_g", factor: G },
  "polyunsaturated-fat": { key: "polyunsaturated_fat_g", factor: G },
  "oleic-acid": { key: "oleic_acid_g", factor: G },
  "linoleic-acid": { key: "linoleic_acid_g", factor: G },
  "alpha-linolenic-acid": { key: "alpha_linolenic_acid_g", factor: G },
  "arachidonic-acid": { key: "arachidonic_acid_g", factor: G },
  "eicosapentaenoic-acid": { key: "epa_g", factor: G },
  "docosahexaenoic-acid": { key: "dha_g", factor: G },
  "butyric-acid": { key: "butyric_acid_g", factor: G },
  "caproic-acid": { key: "caproic_acid_g", factor: G },
  "caprylic-acid": { key: "caprylic_acid_g", factor: G },
  "capric-acid": { key: "capric_acid_g", factor: G },
  "lauric-acid": { key: "lauric_acid_g", factor: G },
  "myristic-acid": { key: "myristic_acid_g", factor: G },
  "palmitic-acid": { key: "palmitic_acid_g", factor: G },
  "stearic-acid": { key: "stearic_acid_g", factor: G },
  cholesterol: { key: "cholesterol_mg", factor: MG },
};

// Produit prêt à entrer dans food_ref (source « off »).
export type OffFood = {
  code: Ean;
  name: string;
  brand: string | null;
  // Contenance de l'emballage, quand elle est en g ou en ml.
  package_quantity: number | null;
  package_unit: "g" | "ml" | null;
  // Les valeurs sont pour 100 g, ou pour 100 ml quand le produit se vend au volume.
  per_100_unit: "g" | "ml";
  micronutrients: Partial<Record<MicronutrientKey, number>>;
  nutrient_details: Partial<Record<NutrientDetailKey, number>>;
} & Record<MainNutrientKey, number | null>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Nombre déclaré, positif ou nul ; OFF renvoie parfois une chaîne. Sinon null.
function amount(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

// Conversion d'unité sans bruit de virgule flottante (0.12 g → 120 mg, pas 119.99999).
function scaled(value: number, factor: number): number {
  return Number((value * factor).toPrecision(10));
}

function unit(value: unknown): "g" | "ml" | null {
  const unit = text(value)?.toLowerCase();
  return unit === "g" || unit === "ml" ? unit : null;
}

// Réponse de l'API produit d'OFF → ligne de food_ref, ou null si le produit est inconnu ou
// n'a pas de nom. Une valeur absente reste null (colonnes) ou sans clé (jsonb) :
// « non renseignée », jamais estimée.
export function mapOffProduct(ean: Ean, payload: unknown): OffFood | null {
  const body = payload as { status?: unknown; product?: unknown } | null;
  if (body?.status !== 1 || typeof body.product !== "object" || body.product === null) return null;
  const product = body.product as Record<string, unknown>;

  const name =
    text(product.product_name_fr) ?? text(product.product_name) ?? text(product.generic_name_fr);
  if (!name) return null;

  const nutriments =
    typeof product.nutriments === "object" && product.nutriments !== null
      ? (product.nutriments as Record<string, unknown>)
      : {};
  const per100 = (id: string) => amount(nutriments[`${id}_100g`]);

  const main = Object.fromEntries(
    Object.entries(OFF_MAIN).map(([id, key]) => [key, per100(id)]),
  ) as Record<MainNutrientKey, number | null>;

  const collect = <K extends string>(table: Record<string, { key: K; factor: number }>) => {
    const values: Partial<Record<K, number>> = {};
    for (const [id, { key, factor }] of Object.entries(table)) {
      const value = per100(id);
      if (value !== null) values[key] = scaled(value, factor);
    }
    return values;
  };

  const packageUnit = unit(product.product_quantity_unit);
  const packageQuantity = amount(product.product_quantity);
  const hasPackage = packageUnit !== null && packageQuantity !== null && packageQuantity > 0;

  return {
    code: ean,
    name,
    brand: text(product.brands),
    package_quantity: hasPackage ? packageQuantity : null,
    package_unit: hasPackage ? packageUnit : null,
    per_100_unit: packageUnit === "ml" ? "ml" : "g",
    ...main,
    micronutrients: collect(OFF_MICRONUTRIENTS),
    nutrient_details: collect(OFF_DETAILS),
  };
}
