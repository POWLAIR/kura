import { z } from "zod";

// Clés stables de food_ref.micronutrients, valeurs pour 100 g.
// Ordre d'affichage : les plus courants d'abord (docs/conception.md, « Affichage nutritionnel »).
// Une clé absente signifie « non renseignée » : on n'estime jamais une valeur manquante.
// Ne jamais renommer une clé : elle est stockée telle quelle en base.
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
] as const;

export type MicronutrientKey = (typeof MICRONUTRIENTS)[number]["key"];

export const MicronutrientKey = z.enum(
  MICRONUTRIENTS.map((m) => m.key) as [MicronutrientKey, ...MicronutrientKey[]],
);

export const Micronutrients = z.partialRecord(MicronutrientKey, z.number().nonnegative());
export type Micronutrients = z.infer<typeof Micronutrients>;
