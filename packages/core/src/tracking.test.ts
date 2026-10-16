import { describe, expect, it } from "vitest";
import { createFoodMatcher, type Food } from "./food-match.ts";
import {
  daysBetween,
  LogMealInput,
  LogWeightInput,
  localDate,
  periodRange,
  resolveMealItems,
  sumNutrition,
} from "./tracking.ts";

describe("schémas", () => {
  const meal = {
    label: "Riz aux œufs",
    items: [{ name: "riz", quantity: 200, unit: "g" }],
    idempotency_key: "repas-0001",
  };

  it("acceptent un repas minimal et une date avec fuseau", () => {
    expect(LogMealInput.safeParse(meal).success).toBe(true);
    expect(LogMealInput.safeParse({ ...meal, eaten_at: "2026-10-16T12:30:00+02:00" }).success).toBe(
      true,
    );
  });

  it.each([
    [{ ...meal, idempotency_key: undefined }, "sans clé d'idempotence"],
    [{ ...meal, items: [] }, "sans aliment"],
    [{ ...meal, eaten_at: "2026-10-16T12:30:00" }, "date sans fuseau"],
    [{ ...meal, items: [{ name: "riz", quantity: 0, unit: "g" }] }, "quantité nulle"],
  ])("refusent %o (%s)", (input, _why) => {
    expect(LogMealInput.safeParse(input).success).toBe(false);
  });

  it("bornent le poids", () => {
    expect(LogWeightInput.safeParse({ weight_kg: 0, idempotency_key: "pesee-0001" }).success).toBe(
      false,
    );
    expect(
      LogWeightInput.safeParse({ weight_kg: 70.4, idempotency_key: "pesee-0001" }).success,
    ).toBe(true);
  });
});

describe("périodes", () => {
  it("donne la date du jour à Paris, pas en UTC", () => {
    expect(localDate(new Date("2026-10-15T22:30:00Z"))).toBe("2026-10-16");
    expect(localDate(new Date("2026-10-15T21:30:00Z"))).toBe("2026-10-15");
  });

  it.each([
    ["2026-10-15", { from: "2026-10-12", to: "2026-10-18" }], // jeudi
    ["2026-10-12", { from: "2026-10-12", to: "2026-10-18" }], // lundi
    ["2026-10-18", { from: "2026-10-12", to: "2026-10-18" }], // dimanche
    ["2026-12-31", { from: "2026-12-28", to: "2027-01-03" }], // à cheval sur deux années
  ])("semaine du %s : du lundi au dimanche", (date, expected) => {
    expect(periodRange("week", date)).toEqual(expected);
  });

  it("un jour, et la liste des jours d'une période", () => {
    expect(periodRange("day", "2026-10-16")).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("sumNutrition", () => {
  const meal = (values: Record<string, number>, incomplete: string[] = [], partial = false) => ({
    totals: { values, incomplete },
    partial_values: partial,
  });

  it("additionne les colonnes principales, au dixième", () => {
    expect(
      sumNutrition([
        meal({ energy_kcal: 400.04, protein_g: 17.5 }),
        meal({ energy_kcal: 130, protein_g: 2.5 }),
      ]),
    ).toEqual({ energy_kcal: 530, protein_g: 20, incomplete: [], partial_values: false });
  });

  it("signale une valeur absente d'un repas, ou minimale dans un repas", () => {
    const summary = sumNutrition([
      meal({ energy_kcal: 400, sugars_g: 0.5 }, ["sugars_g"]),
      meal({ energy_kcal: 130, fiber_g: 1 }, [], true),
    ]);
    expect(summary.incomplete).toEqual(["sugars_g", "fiber_g"]);
    expect(summary.partial_values).toBe(true);
    expect(summary.salt_g).toBeUndefined(); // non renseignée, jamais 0
  });

  it("ne garde que les colonnes principales", () => {
    expect(sumNutrition([meal({ iron_mg: 2 })])).toEqual({ incomplete: [], partial_values: false });
  });
});

describe("resolveMealItems", () => {
  const foods: Food[] = [
    { id: 1, code: "11013", name: "Moutarde" },
    { id: 2, code: "9100", name: "Riz blanc, cru" },
    { id: 3, code: "9119", name: "Riz thaï ou basmati, cru" },
  ];
  const ctx = {
    foodsById: new Map(foods.map((f) => [f.id, f])),
    matchFood: createFoodMatcher(foods),
  };

  it("rattache, convertit les unités et garde les aliments sans référence", () => {
    expect(
      resolveMealItems(
        [
          { name: "moutarde", quantity: 10, unit: "g" },
          { name: "riz", quantity: 0.2, unit: "kg", food_ref_id: 2 },
          { name: "Sauce Kim Kee", quantity: 1.5, unit: "cl", food_ref_id: null },
        ],
        ctx,
      ),
    ).toEqual({
      items: [
        { name: "moutarde", food_ref_id: 1, quantity: 10, unit: "g" },
        { name: "riz", food_ref_id: 2, quantity: 200, unit: "g" },
        { name: "Sauce Kim Kee", food_ref_id: null, quantity: 15, unit: "ml" },
      ],
      ambiguous: [],
    });
  });

  it("renvoie les aliments ambigus ou inconnus avec leurs candidats", () => {
    const { ambiguous } = resolveMealItems(
      [
        { name: "riz", quantity: 200, unit: "g" },
        { name: "truc", quantity: 1, unit: "piece", food_ref_id: 99 },
      ],
      ctx,
    );
    expect(ambiguous.map((a) => [a.name, a.reason, a.candidates.map((f) => f.id)])).toEqual([
      ["riz", "food", [2, 3]],
      ["truc", "unknown_food", []],
    ]);
  });
});
