import { describe, expect, it } from "vitest";
import { MICRONUTRIENTS, Micronutrients } from "./nutrients";

describe("micronutriments", () => {
  it("a des clés uniques, suffixées par leur unité", () => {
    const keys = MICRONUTRIENTS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MICRONUTRIENTS) {
      expect(m.key.endsWith(m.unit === "µg" ? "_ug" : "_mg")).toBe(true);
    }
  });

  it("accepte un sous-ensemble de clés connues", () => {
    expect(Micronutrients.parse({ iron_mg: 0.2 })).toEqual({ iron_mg: 0.2 });
  });

  it("refuse une clé inconnue ou une valeur négative", () => {
    expect(Micronutrients.safeParse({ fer: 1 }).success).toBe(false);
    expect(Micronutrients.safeParse({ iron_mg: -1 }).success).toBe(false);
  });
});
