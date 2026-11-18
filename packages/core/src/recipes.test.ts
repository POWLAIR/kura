import { describe, expect, it } from "vitest";
import { createFoodMatcher, type Food } from "./food-match.ts";
import type { InventoryItemView } from "./inventory-view.ts";
import type { InventoryLine } from "./purchase.ts";
import {
  CookRecipeInput,
  cookStockReport,
  generatedToSaveInput,
  type IngredientContext,
  ingredientAmount,
  ingredientAvailability,
  RecipeIngredientInput,
  recipePrompt,
  resolveRecipeIngredients,
  SaveRecipeInput,
  stockForRecipes,
  usesExpiring,
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

describe("propositions depuis le stock", () => {
  const today = "2026-11-18";
  const items = [
    { id: 1, name: "Riz", category: "feculents", location: "placard", quantity: 1000, unit: "g" },
    {
      id: 2,
      name: "Yaourt",
      category: "frais",
      location: "frigo",
      quantity: 2,
      unit: "piece",
      expires_on: "2026-11-19",
    },
    {
      id: 3,
      name: "Crème",
      category: "frais",
      location: "frigo",
      quantity: 20,
      unit: "cl",
      expires_on: "2026-11-10",
    },
    { id: 4, name: "Sauce soja", category: "sauces", location: "placard", level: "moitie" },
    { id: 5, name: "Farine", category: "feculents", location: "placard", quantity: 0, unit: "g" },
    {
      id: 6,
      name: "Courgette",
      category: "frais",
      location: "frigo",
      quantity: 1,
      unit: "piece",
      expires_on: "2026-12-01",
    },
  ] as InventoryItemView[];

  it("stockForRecipes : ce qui périme d'abord, ni vide ni périmé", () => {
    expect(stockForRecipes(items, today)).toEqual([
      {
        item_id: 2,
        name: "Yaourt",
        amount: "2 pièces",
        expires_on: "2026-11-19",
        expires_soon: true,
      },
      { item_id: 6, name: "Courgette", amount: "1 pièce", expires_on: "2026-12-01" },
      { item_id: 1, name: "Riz", amount: "1 kg" },
      { item_id: 4, name: "Sauce soja", amount: "Moitié" },
    ]);
  });

  const stock = stockForRecipes(items, today);
  const generated = {
    title: " Riz au yaourt ",
    servings: 2.4,
    total_minutes: 0,
    steps: ["Cuire.", " "],
    ingredients: [
      { name: "riz", quantity: 150, unit: "g" as const, item_id: 1 },
      { name: "yaourt", quantity: 1, unit: "piece" as const, item_id: 2 },
      { name: "sel", quantity: null, unit: null, item_id: null },
      { name: "beurre", quantity: 10, unit: null, item_id: 99 },
    ],
  };

  it("generatedToSaveInput : bornes, ids inconnus ignorés, quantité sans unité retirée", () => {
    expect(generatedToSaveInput(generated, stock, "gen-00000001")).toEqual({
      title: "Riz au yaourt",
      servings: 2,
      steps: ["Cuire."],
      ingredients: [
        { name: "riz", quantity: 150, unit: "g", item_id: 1 },
        { name: "yaourt", quantity: 1, unit: "piece", item_id: 2 },
        { name: "sel" },
        { name: "beurre" },
      ],
      origin: "generee",
      idempotency_key: "gen-00000001",
    });
    expect(
      generatedToSaveInput({ ...generated, ingredients: [] }, stock, "gen-00000002"),
    ).toBeNull();
  });

  it("usesExpiring : les articles qui périment bientôt", () => {
    expect(usesExpiring(generated.ingredients, stock)).toEqual(["Yaourt"]);
    expect(usesExpiring([{ item_id: 1 }], stock)).toEqual([]);
  });

  it("recipePrompt : seulement la demande et le stock", () => {
    expect(JSON.parse(recipePrompt(stock, { max_minutes: 20 }))).toEqual({
      demande: { max_minutes: 20 },
      stock,
    });
  });
});

describe("fiche recette", () => {
  const inventory = [
    { id: 1, name: "Riz", category: "feculents", location: "placard", quantity: 150, unit: "g" },
    { id: 2, name: "Sauce soja", category: "sauces", location: "placard", level: "moitie" },
    { id: 3, name: "Oeufs", category: "frais", location: "frigo", quantity: 0, unit: "piece" },
    { id: 4, name: "Lait", category: "frais", location: "frigo", quantity: 1000, unit: "ml" },
  ] as InventoryItemView[];

  it.each([
    [{ name: "riz", quantity: 100, unit: "g", item_id: 1 }, 1, "available", "En stock : 150 g"],
    [{ name: "riz", quantity: 100, unit: "g", item_id: 1 }, 2, "short", "Il en reste 150 g"],
    [{ name: "sauce", quantity: 30, unit: "ml", item_id: 2 }, 1, "available", "En stock : Moitié"],
    [{ name: "œufs", quantity: 2, unit: "piece", item_id: 3 }, 1, "missing", "Stock épuisé"],
    [{ name: "lait", quantity: 100, unit: "g", item_id: 4 }, 1, "available", "En stock : 1 l"],
    [{ name: "sel" }, 1, "missing", "Pas dans le stock"],
    [{ name: "beurre", item_id: 99 }, 1, "missing", "Pas dans le stock"],
  ] as const)("ingredientAvailability %o ×%d", (ingredient, factor, status, label) => {
    expect(ingredientAvailability(ingredient, inventory, factor)).toEqual({ status, label });
  });

  it("ingredientAmount : au prorata, « à votre goût » sans quantité", () => {
    expect(ingredientAmount({ name: "riz", quantity: 200, unit: "g" }, 0.5)).toBe("100 g");
    expect(ingredientAmount({ name: "œufs", quantity: 3, unit: "piece" }, 1)).toBe("3 pièces");
    expect(ingredientAmount({ name: "sel" })).toBe("à votre goût");
  });
});
