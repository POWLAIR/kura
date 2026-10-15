import type {
  MicronutrientKey,
  Micronutrients,
  NutrientDetailKey,
  NutrientDetails,
  TablesInsert,
} from "@kura/core";
import { XMLParser } from "fast-xml-parser";

// Parsing de la table Ciqual (Anses), format XML : alim_*.xml, const_*.xml, compo_*.xml.
// Les constituants sont identifiés par leur const_code, stable d'une version à l'autre.
// Choix et clés documentés dans docs/ciqual.md.

type MainColumn =
  | "energy_kcal"
  | "protein_g"
  | "carbs_g"
  | "sugars_g"
  | "fat_g"
  | "saturated_fat_g"
  | "fiber_g"
  | "salt_g";

type Unit = "g" | "mg" | "µg" | "kcal";

// const_code → colonne de food_ref, avec l'unité attendue dans const_nom_fr.
export const MAIN_CONSTITUENTS: Record<string, { column: MainColumn; unit: Unit }> = {
  "328": { column: "energy_kcal", unit: "kcal" }, // Énergie, règlement UE 1169/2011
  "25003": { column: "protein_g", unit: "g" }, // Protéines, N x 6.25 (base du règlement UE)
  "31000": { column: "carbs_g", unit: "g" },
  "32000": { column: "sugars_g", unit: "g" },
  "40000": { column: "fat_g", unit: "g" },
  "40302": { column: "saturated_fat_g", unit: "g" },
  "34100": { column: "fiber_g", unit: "g" },
  "10004": { column: "salt_g", unit: "g" }, // Sel chlorure de sodium
};

export const MICRO_CONSTITUENTS: Record<string, { key: MicronutrientKey; unit: Unit }> = {
  "10260": { key: "iron_mg", unit: "mg" },
  "10200": { key: "calcium_mg", unit: "mg" },
  "10120": { key: "magnesium_mg", unit: "mg" },
  "55100": { key: "vitamin_c_mg", unit: "mg" },
  "10190": { key: "potassium_mg", unit: "mg" },
  "52100": { key: "vitamin_d_ug", unit: "µg" },
  "56600": { key: "vitamin_b12_ug", unit: "µg" },
  "56700": { key: "vitamin_b9_ug", unit: "µg" }, // Folates totaux
  "10300": { key: "zinc_mg", unit: "mg" },
  "51104": { key: "vitamin_a_ug", unit: "µg" }, // Équivalents rétinol
  "53100": { key: "vitamin_e_mg", unit: "mg" },
  "56100": { key: "vitamin_b1_mg", unit: "mg" },
  "56200": { key: "vitamin_b2_mg", unit: "mg" },
  "56310": { key: "vitamin_b3_mg", unit: "mg" },
  "56400": { key: "vitamin_b5_mg", unit: "mg" },
  "56500": { key: "vitamin_b6_mg", unit: "mg" },
  "54101": { key: "vitamin_k1_ug", unit: "µg" },
  "54104": { key: "vitamin_k2_ug", unit: "µg" },
  "10150": { key: "phosphorus_mg", unit: "mg" },
  "10530": { key: "iodine_ug", unit: "µg" },
  "10340": { key: "selenium_ug", unit: "µg" },
  "10290": { key: "copper_mg", unit: "mg" },
  "10251": { key: "manganese_mg", unit: "mg" },
  "10170": { key: "chloride_mg", unit: "mg" },
};

export const DETAIL_CONSTITUENTS: Record<string, { key: NutrientDetailKey; unit: Unit }> = {
  "33110": { key: "starch_g", unit: "g" },
  "32480": { key: "sucrose_g", unit: "g" },
  "32250": { key: "glucose_g", unit: "g" },
  "32210": { key: "fructose_g", unit: "g" },
  "32410": { key: "lactose_g", unit: "g" },
  "32430": { key: "maltose_g", unit: "g" },
  "32220": { key: "galactose_g", unit: "g" },
  "40303": { key: "monounsaturated_fat_g", unit: "g" },
  "40304": { key: "polyunsaturated_fat_g", unit: "g" },
  "41819": { key: "oleic_acid_g", unit: "g" },
  "41826": { key: "linoleic_acid_g", unit: "g" },
  "41833": { key: "alpha_linolenic_acid_g", unit: "g" },
  "42046": { key: "arachidonic_acid_g", unit: "g" },
  "42053": { key: "epa_g", unit: "g" },
  "42263": { key: "dha_g", unit: "g" },
  "40400": { key: "butyric_acid_g", unit: "g" },
  "40600": { key: "caproic_acid_g", unit: "g" },
  "40800": { key: "caprylic_acid_g", unit: "g" },
  "41000": { key: "capric_acid_g", unit: "g" },
  "41200": { key: "lauric_acid_g", unit: "g" },
  "41400": { key: "myristic_acid_g", unit: "g" },
  "41600": { key: "palmitic_acid_g", unit: "g" },
  "41800": { key: "stearic_acid_g", unit: "g" },
  "75100": { key: "cholesterol_mg", unit: "mg" },
  "400": { key: "water_g", unit: "g" },
  "60000": { key: "alcohol_g", unit: "g" },
};

export type FoodRefRow = TablesInsert<"food_ref"> & {
  micronutrients: Micronutrients;
  nutrient_details: NutrientDetails;
};

/**
 * Convertit une teneur Ciqual en nombre.
 * « - » (non mesuré), « traces » et « < x » (sous le seuil) donnent null : la valeur
 * sera affichée « non renseignée », jamais remplacée par 0 ou par une estimation.
 * Un format inconnu lève une erreur plutôt que d'être deviné.
 */
export function parseCiqualValue(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (value === "" || value === "-" || value.toLowerCase() === "traces" || value.startsWith("<")) {
    return null;
  }
  if (/^\d+(,\d+)?$/.test(value)) {
    return Number(value.replace(",", "."));
  }
  throw new Error(`Teneur Ciqual au format inconnu : « ${value} »`);
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "ALIM" || name === "CONST" || name === "COMPO",
});

function parseTable<T>(xml: string, element: string): T[] {
  const doc = parser.parse(xml.replace(/^﻿/, "")) as { TABLE?: Record<string, T[]> };
  return doc.TABLE?.[element] ?? [];
}

type AlimXml = { alim_code: string; alim_nom_fr: string };
type ConstXml = { const_code: string; const_nom_fr: string };
type CompoXml = { alim_code: string; const_code: string; teneur?: string };

/** Vérifie que chaque const_code utilisé existe et porte l'unité attendue. */
export function checkConstituents(constXml: string): void {
  const names = new Map(
    parseTable<ConstXml>(constXml, "CONST").map((c) => [String(c.const_code), c.const_nom_fr]),
  );
  const expected = [
    ...Object.entries(MAIN_CONSTITUENTS),
    ...Object.entries(MICRO_CONSTITUENTS),
    ...Object.entries(DETAIL_CONSTITUENTS),
  ].map(([code, { unit }]) => [code, unit] as const);

  for (const [code, unit] of expected) {
    const name = names.get(code);
    if (!name) throw new Error(`Constituant Ciqual ${code} absent de const.xml`);
    if (!name.endsWith(`(${unit}/100 g)`)) {
      throw new Error(`Constituant Ciqual ${code} (« ${name} ») : unité attendue ${unit}/100 g`);
    }
  }
}

export function parseCiqual(files: { alim: string; const: string; compo: string }): FoodRefRow[] {
  checkConstituents(files.const);

  const rows = new Map<string, FoodRefRow>();
  for (const alim of parseTable<AlimXml>(files.alim, "ALIM")) {
    const code = String(alim.alim_code);
    rows.set(code, {
      source: "ciqual",
      code,
      name: alim.alim_nom_fr,
      energy_kcal: null,
      protein_g: null,
      carbs_g: null,
      sugars_g: null,
      fat_g: null,
      saturated_fat_g: null,
      fiber_g: null,
      salt_g: null,
      micronutrients: {},
      nutrient_details: {},
    });
  }

  for (const compo of parseTable<CompoXml>(files.compo, "COMPO")) {
    const constCode = String(compo.const_code);
    const main = MAIN_CONSTITUENTS[constCode];
    const micro = MICRO_CONSTITUENTS[constCode];
    const detail = DETAIL_CONSTITUENTS[constCode];
    if (!main && !micro && !detail) continue;

    const row = rows.get(String(compo.alim_code));
    if (!row) throw new Error(`Aliment ${compo.alim_code} présent dans compo mais pas dans alim`);

    const value = parseCiqualValue(compo.teneur);
    if (value === null) continue;
    if (main) row[main.column] = value;
    if (micro) row.micronutrients[micro.key] = value;
    if (detail) row.nutrient_details[detail.key] = value;
  }

  return [...rows.values()];
}
