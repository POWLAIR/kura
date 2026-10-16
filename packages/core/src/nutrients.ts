import { z } from "zod";

// Clés stables des colonnes jsonb de food_ref, valeurs pour 100 g.
// Une clé absente signifie « non renseignée » : on n'estime jamais une valeur manquante.
// Ne jamais renommer une clé : elle est stockée telle quelle en base.
// Le suffixe donne l'unité (_g, _mg, _ug).

type NutrientDef = { key: string; label: string; unit: "g" | "mg" | "µg" };

function keySchema<const T extends readonly NutrientDef[]>(defs: T) {
  type Key = T[number]["key"];
  const key = z.enum(defs.map((d) => d.key) as [Key, ...Key[]]);
  return { key, values: z.partialRecord(key, z.number().nonnegative()) };
}

// Colonnes principales de food_ref, toujours visibles (docs/conception.md, « Affichage
// nutritionnel »), dans l'ordre d'affichage.
export const MAIN_NUTRIENTS = [
  { key: "energy_kcal", label: "Énergie", unit: "kcal" },
  { key: "protein_g", label: "Protéines", unit: "g" },
  { key: "carbs_g", label: "Glucides", unit: "g" },
  { key: "sugars_g", label: "dont sucres", unit: "g" },
  { key: "fat_g", label: "Lipides", unit: "g" },
  { key: "saturated_fat_g", label: "dont acides gras saturés", unit: "g" },
  { key: "fiber_g", label: "Fibres", unit: "g" },
  { key: "salt_g", label: "Sel", unit: "g" },
] as const;
export type MainNutrientKey = (typeof MAIN_NUTRIENTS)[number]["key"];

// food_ref.micronutrients : vitamines et minéraux.
// Ordre d'affichage : les plus courants d'abord (docs/conception.md, « Affichage nutritionnel »).
export const MICRONUTRIENTS = [
  { key: "iron_mg", label: "Fer", unit: "mg" },
  { key: "calcium_mg", label: "Calcium", unit: "mg" },
  { key: "magnesium_mg", label: "Magnésium", unit: "mg" },
  { key: "vitamin_c_mg", label: "Vitamine C", unit: "mg" },
  { key: "potassium_mg", label: "Potassium", unit: "mg" },
  { key: "vitamin_d_ug", label: "Vitamine D", unit: "µg" },
  { key: "vitamin_b12_ug", label: "Vitamine B12", unit: "µg" },
  { key: "vitamin_b9_ug", label: "Vitamine B9 (folates)", unit: "µg" },
  { key: "zinc_mg", label: "Zinc", unit: "mg" },
  { key: "vitamin_a_ug", label: "Vitamine A", unit: "µg" },
  { key: "vitamin_e_mg", label: "Vitamine E", unit: "mg" },
  { key: "vitamin_b1_mg", label: "Vitamine B1 (thiamine)", unit: "mg" },
  { key: "vitamin_b2_mg", label: "Vitamine B2 (riboflavine)", unit: "mg" },
  { key: "vitamin_b3_mg", label: "Vitamine B3 (niacine)", unit: "mg" },
  { key: "vitamin_b5_mg", label: "Vitamine B5 (acide pantothénique)", unit: "mg" },
  { key: "vitamin_b6_mg", label: "Vitamine B6", unit: "mg" },
  { key: "vitamin_k1_ug", label: "Vitamine K1", unit: "µg" },
  { key: "vitamin_k2_ug", label: "Vitamine K2", unit: "µg" },
  { key: "phosphorus_mg", label: "Phosphore", unit: "mg" },
  { key: "iodine_ug", label: "Iode", unit: "µg" },
  { key: "selenium_ug", label: "Sélénium", unit: "µg" },
  { key: "copper_mg", label: "Cuivre", unit: "mg" },
  { key: "manganese_mg", label: "Manganèse", unit: "mg" },
  { key: "chloride_mg", label: "Chlorure", unit: "mg" },
] as const satisfies readonly NutrientDef[];

// food_ref.nutrient_details : détail des glucides et des lipides, puis autres constituants.
// `parent` rattache une valeur à la ligne principale qu'elle détaille, pour l'affichage.
export const NUTRIENT_DETAILS = [
  { key: "starch_g", label: "Amidon", unit: "g", parent: "carbs_g" },
  { key: "sucrose_g", label: "Saccharose", unit: "g", parent: "sugars_g" },
  { key: "glucose_g", label: "Glucose", unit: "g", parent: "sugars_g" },
  { key: "fructose_g", label: "Fructose", unit: "g", parent: "sugars_g" },
  { key: "lactose_g", label: "Lactose", unit: "g", parent: "sugars_g" },
  { key: "maltose_g", label: "Maltose", unit: "g", parent: "sugars_g" },
  { key: "galactose_g", label: "Galactose", unit: "g", parent: "sugars_g" },
  { key: "monounsaturated_fat_g", label: "AG monoinsaturés", unit: "g", parent: "fat_g" },
  { key: "polyunsaturated_fat_g", label: "AG polyinsaturés", unit: "g", parent: "fat_g" },
  {
    key: "oleic_acid_g",
    label: "Acide oléique (oméga 9)",
    unit: "g",
    parent: "monounsaturated_fat_g",
  },
  {
    key: "linoleic_acid_g",
    label: "Acide linoléique (oméga 6)",
    unit: "g",
    parent: "polyunsaturated_fat_g",
  },
  {
    key: "alpha_linolenic_acid_g",
    label: "Acide alpha-linolénique (oméga 3)",
    unit: "g",
    parent: "polyunsaturated_fat_g",
  },
  {
    key: "arachidonic_acid_g",
    label: "Acide arachidonique (oméga 6)",
    unit: "g",
    parent: "polyunsaturated_fat_g",
  },
  { key: "epa_g", label: "EPA (oméga 3)", unit: "g", parent: "polyunsaturated_fat_g" },
  { key: "dha_g", label: "DHA (oméga 3)", unit: "g", parent: "polyunsaturated_fat_g" },
  { key: "butyric_acid_g", label: "Acide butyrique (4:0)", unit: "g", parent: "saturated_fat_g" },
  { key: "caproic_acid_g", label: "Acide caproïque (6:0)", unit: "g", parent: "saturated_fat_g" },
  { key: "caprylic_acid_g", label: "Acide caprylique (8:0)", unit: "g", parent: "saturated_fat_g" },
  { key: "capric_acid_g", label: "Acide caprique (10:0)", unit: "g", parent: "saturated_fat_g" },
  { key: "lauric_acid_g", label: "Acide laurique (12:0)", unit: "g", parent: "saturated_fat_g" },
  {
    key: "myristic_acid_g",
    label: "Acide myristique (14:0)",
    unit: "g",
    parent: "saturated_fat_g",
  },
  {
    key: "palmitic_acid_g",
    label: "Acide palmitique (16:0)",
    unit: "g",
    parent: "saturated_fat_g",
  },
  { key: "stearic_acid_g", label: "Acide stéarique (18:0)", unit: "g", parent: "saturated_fat_g" },
  { key: "cholesterol_mg", label: "Cholestérol", unit: "mg", parent: null },
  { key: "water_g", label: "Eau", unit: "g", parent: null },
  { key: "alcohol_g", label: "Alcool", unit: "g", parent: null },
] as const satisfies readonly (NutrientDef & { parent: string | null })[];

const micro = keySchema(MICRONUTRIENTS);
export const MicronutrientKey = micro.key;
export type MicronutrientKey = z.infer<typeof MicronutrientKey>;
export const Micronutrients = micro.values;
export type Micronutrients = z.infer<typeof Micronutrients>;

const details = keySchema(NUTRIENT_DETAILS);
export const NutrientDetailKey = details.key;
export type NutrientDetailKey = z.infer<typeof NutrientDetailKey>;
export const NutrientDetails = details.values;
export type NutrientDetails = z.infer<typeof NutrientDetails>;
