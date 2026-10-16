import { describe, expect, it } from "vitest";
import {
  MAIN_NUTRIENTS,
  MICRONUTRIENTS,
  Micronutrients,
  NUTRIENT_DETAILS,
  NutrientDetails,
} from "./nutrients.ts";

const SUFFIX = { g: "_g", mg: "_mg", µg: "_ug" } as const;
const MAIN_COLUMNS = ["carbs_g", "sugars_g", "fat_g", "saturated_fat_g"];

describe.each([
  ["micronutrients", MICRONUTRIENTS],
  ["nutrient_details", NUTRIENT_DETAILS],
] as const)("%s", (_, defs) => {
  it("a des clés uniques, suffixées par leur unité", () => {
    const keys = defs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of defs) expect(d.key.endsWith(SUFFIX[d.unit])).toBe(true);
  });
});

it("aucune clé n'est partagée entre colonnes principales, micronutrients et nutrient_details", () => {
  const keys = [...MAIN_NUTRIENTS, ...MICRONUTRIENTS, ...NUTRIENT_DETAILS].map((n) => n.key);
  expect(new Set(keys).size).toBe(keys.length);
});

it("chaque détail se rattache à une colonne principale ou à un autre détail", () => {
  const known = new Set<string>([...MAIN_COLUMNS, ...NUTRIENT_DETAILS.map((d) => d.key)]);
  for (const d of NUTRIENT_DETAILS) {
    if (d.parent !== null) expect(known.has(d.parent), d.key).toBe(true);
  }
});

describe("schémas Zod", () => {
  it("acceptent un sous-ensemble de clés connues", () => {
    expect(Micronutrients.parse({ iron_mg: 0.2 })).toEqual({ iron_mg: 0.2 });
    expect(NutrientDetails.parse({ starch_g: 28 })).toEqual({ starch_g: 28 });
  });

  it("refusent une clé inconnue, une clé de l'autre colonne ou une valeur négative", () => {
    expect(Micronutrients.safeParse({ fer: 1 }).success).toBe(false);
    expect(Micronutrients.safeParse({ starch_g: 1 }).success).toBe(false);
    expect(NutrientDetails.safeParse({ iron_mg: 1 }).success).toBe(false);
    expect(Micronutrients.safeParse({ iron_mg: -1 }).success).toBe(false);
  });
});
