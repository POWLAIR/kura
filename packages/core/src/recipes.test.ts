import { describe, expect, it } from "vitest";
import { createFoodMatcher, type Food } from "./food-match.ts";
import type { InventoryLine } from "./purchase.ts";
import {
  CookRecipeInput,
  cookStockReport,
  type IngredientContext,
  RecipeIngredientInput,
  resolveRecipeIngredients,
  SaveRecipeInput,
} from "./recipes.ts";

const foods: Food[] = [
  { id: 1, code: "riz-b", name: "Riz basmati, cru" },
  { id: 2, code: "riz-c", name: "Riz complet, cru" },
  { id: 3, code: "oeuf", name: "Oeuf, cru" },
  { id: 4, code: "oignon", name: "Oignon, cru" },
];

const line = (id: number, name: string, food_ref_id: number | null): InventoryLine => ({
  id,
  name,
  location: "placard",
  food_ref_id,
  quantity: 100,
  unit: "g",
  level: null,
});

function context(inventory: InventoryLine[]): IngredientContext {
  return {
    inventory,
    foodsById: new Map(foods.map((f) => [f.id, f])),
    matchFood: createFoodMatcher(foods, { maxCandidates: 5 }),
  };
}

describe("schémas", () => {
  const recipe = {
    title: "Riz sauté",
    servings: 2,
    steps: ["Cuire le riz."],
    ingredients: [{ name: "riz", quantity: 200, unit: "g" }],
    idempotency_key: "recette-0001",
  };

  it("acceptent une recette minimale, origine generee par défaut", () => {
    const parsed = SaveRecipeInput.parse(recipe);
    expect(parsed.origin).toBe("generee");
  });

  it("acceptent un ingrédient sans quantité (sel)", () => {
    expect(RecipeIngredientInput.safeParse({ name: "sel" }).success).toBe(true);
  });

  it.each([
    [{ name: "riz", quantity: 200 }, "quantité sans unité"],
    [{ name: "riz", unit: "g" }, "unité sans quantité"],
  ])("refusent %o (%s)", (input, _why) => {
    expect(RecipeIngredientInput.safeParse(input).success).toBe(false);
  });

  it("refusent plus de portions mangées que cuisinées", () => {
    const cook = { recipe_id: 1, portions_eaten: 3, idempotency_key: "repas-0001" };
    expect(CookRecipeInput.safeParse(cook).success).toBe(true);
    expect(CookRecipeInput.safeParse({ ...cook, portions_cooked: 2 }).success).toBe(false);
  });
});

describe("resolveRecipeIngredients", () => {
  it("relie l'aliment et l'article du même nom, convertit les unités", () => {
    const { ingredients, ambiguous } = resolveRecipeIngredients(
      [{ name: "Oeufs", quantity: 2, unit: "piece" }],
      context([line(10, "Oeuf", 3)]),
    );
    expect(ambiguous).toEqual([]);
    expect(ingredients).toEqual([
      { name: "Oeufs", quantity: 2, unit: "piece", food_ref_id: 3, inventory_item_id: 10 },
    ]);
  });

  it("retrouve l'article par son aliment sous un autre nom", () => {
    const { ingredients } = resolveRecipeIngredients(
      [{ name: "riz", quantity: 0.2, unit: "kg", food_ref_id: 1 }],
      context([line(11, "Riz long", 1)]),
    );
    expect(ingredients[0]).toMatchObject({ quantity: 200, unit: "g", inventory_item_id: 11 });
  });

  it("strict : un aliment ambigu renvoie les candidats", () => {
    const { ingredients, ambiguous } = resolveRecipeIngredients(
      [{ name: "riz", quantity: 200, unit: "g" }],
      context([]),
    );
    expect(ingredients).toEqual([]);
    expect(ambiguous[0]).toMatchObject({ index: 0, reason: "food" });
    expect(ambiguous[0]?.candidates.map((f) => f.id).sort()).toEqual([1, 2]);
  });

  it("souple : un aliment ambigu reste sans référence", () => {
    const { ingredients, ambiguous } = resolveRecipeIngredients(
      [{ name: "riz", quantity: 200, unit: "g" }],
      context([]),
      "lenient",
    );
    expect(ambiguous).toEqual([]);
    expect(ingredients[0]).toMatchObject({ food_ref_id: null, inventory_item_id: null });
  });

  it("strict : plusieurs articles du même nom, préciser item_id", () => {
    const inventory = [
      line(12, "Oignon", 4),
      { ...line(13, "Oignon", 4), location: "frigo" as const },
    ];
    const { ambiguous } = resolveRecipeIngredients([{ name: "oignon" }], context(inventory));
    expect(ambiguous[0]).toMatchObject({ reason: "several_items" });
    expect(ambiguous[0]?.items.map((i) => i.id)).toEqual([12, 13]);

    const chosen = resolveRecipeIngredients([{ name: "oignon", item_id: 13 }], context(inventory));
    expect(chosen.ingredients[0]).toMatchObject({ inventory_item_id: 13, food_ref_id: 4 });
  });

  it("choix explicites : aucun article, aucune référence, ids inconnus", () => {
    const ctx = context([line(10, "Oeuf", 3)]);
    expect(
      resolveRecipeIngredients([{ name: "oeuf", item_id: null, food_ref_id: null }], ctx)
        .ingredients[0],
    ).toMatchObject({ inventory_item_id: null, food_ref_id: null, quantity: null });
    expect(resolveRecipeIngredients([{ name: "x", item_id: 99 }], ctx).ambiguous[0]?.reason).toBe(
      "unknown_item",
    );
    expect(
      resolveRecipeIngredients([{ name: "x", food_ref_id: 99 }], ctx).ambiguous[0]?.reason,
    ).toBe("unknown_food");
  });
});

describe("cookStockReport", () => {
  it("sépare le décompté de ce qui reste à ajuster", () => {
    const report = cookStockReport([
      { ingredient: "riz", item_id: 1, item: "Riz", status: "decremented", delta: 200, unit: "g" },
      {
        ingredient: "œufs",
        item_id: 2,
        item: "Oeufs",
        status: "insufficient",
        delta: 1,
        unit: "piece",
      },
      { ingredient: "sauce", item_id: 3, item: "Sauce soja", status: "level" },
    ]);
    expect(report.decremented).toEqual([
      { item_id: 1, item: "Riz", used: 200, unit: "g" },
      { item_id: 2, item: "Oeufs", used: 1, unit: "piece" },
    ]);
    expect(report.to_adjust.map((a) => [a.item_id, a.reason])).toEqual([
      [2, "le stock est arrivé à 0 avant la quantité de la recette"],
      [3, "article suivi en niveau"],
    ]);
  });
});
