import { describe, expect, it } from "vitest";
import { createFoodMatcher, type Food } from "./food-match.ts";
import type { PurchaseItem } from "./inventory.ts";
import { type InventoryLine, type PurchaseContext, planPurchase } from "./purchase.ts";

const foods: Food[] = [
  { id: 1, code: "22000", name: "Oeuf cru" },
  { id: 2, code: "9100", name: "Riz blanc, cru" },
  { id: 3, code: "9119", name: "Riz thaï ou basmati, cru" },
  { id: 4, code: "11013", name: "Moutarde" },
  { id: 5, code: "16400", name: "Beurre à 80% MG minimum, doux" },
];

const line = (id: number, name: string, extra: Partial<InventoryLine> = {}): InventoryLine => ({
  id,
  name,
  location: "placard",
  food_ref_id: null,
  quantity: null,
  unit: null,
  level: "plein",
  ...extra,
});

const inventory: InventoryLine[] = [
  line(10, "Œufs", { location: "frigo", food_ref_id: 1, quantity: 12, unit: "piece", level: null }),
  line(11, "Riz long", { food_ref_id: 2 }),
  line(12, "Beurre doux", {
    location: "congelateur",
    food_ref_id: 5,
    quantity: 500,
    unit: "g",
    level: null,
  }),
  line(13, "Beurre doux", {
    location: "frigo",
    food_ref_id: 5,
    quantity: 1,
    unit: "piece",
    level: null,
  }),
  line(14, "Sauce soja"),
];

const ctx: PurchaseContext = {
  inventory,
  foodsById: new Map(foods.map((f) => [f.id, f])),
  matchFood: createFoodMatcher(foods, { maxCandidates: 5 }),
};

const plan = (input: Omit<PurchaseItem, "category"> & Partial<Pick<PurchaseItem, "category">>) =>
  planPurchase({ category: "frais", ...input }, ctx);

describe("réassort d'un article existant", () => {
  it("par le nom, sans accent ni pluriel, avec conversion d'unité", () => {
    expect(plan({ name: "oeuf", quantity: 6, unit: "piece" })).toMatchObject({
      action: "restock",
      item: { id: 10 },
      amount: { quantity: 6, unit: "piece" },
    });
  });

  it("article en niveau : remis à plein, quelle que soit la quantité achetée", () => {
    expect(plan({ name: "Sauce soja", quantity: 50, unit: "cl" })).toMatchObject({
      action: "restock",
      item: { id: 14 },
      amount: null,
    });
  });

  it("par l'aliment choisi, sous un autre nom", () => {
    expect(plan({ name: "Riz", food_ref_id: 2 })).toMatchObject({
      action: "restock",
      item: { id: 11 },
    });
  });

  it("par item_id, et l'emplacement départage deux articles du même nom", () => {
    expect(plan({ name: "Beurre", item_id: 13, quantity: 1, unit: "piece" })).toMatchObject({
      action: "restock",
      item: { id: 13 },
    });
    expect(
      plan({ name: "Beurre doux", location: "congelateur", quantity: 250, unit: "g" }),
    ).toMatchObject({ action: "restock", item: { id: 12 }, amount: { quantity: 250 } });
  });

  it("garde la date de péremption pour la fonction SQL", () => {
    expect(
      plan({ name: "Œufs", quantity: 6, unit: "piece", expires_on: "2026-11-01" }),
    ).toMatchObject({ action: "restock", expiresOn: "2026-11-01" });
  });
});

describe("création", () => {
  it("lie l'aliment quand un seul correspond, emplacement par défaut selon la catégorie", () => {
    expect(plan({ name: "Moutarde", category: "sauces" })).toEqual({
      action: "create",
      name: "Moutarde",
      category: "sauces",
      location: "placard",
      amount: null,
      food: foods[3],
      expiresOn: null,
    });
  });

  it("sans aliment de référence quand food_ref_id vaut null", () => {
    expect(plan({ name: "Sauce Kim Kee", category: "sauces", food_ref_id: null })).toMatchObject({
      action: "create",
      food: null,
    });
  });

  it("un autre emplacement donne un nouvel article", () => {
    expect(
      plan({ name: "Œufs", location: "placard", quantity: 6, unit: "piece", food_ref_id: 1 }),
    ).toMatchObject({ action: "create", location: "placard", food: foods[0] });
  });
});

describe("ambiguïtés : rien n'est deviné", () => {
  it("aliment ambigu : candidats et articles proches", () => {
    const result = plan({ name: "Riz basmati", category: "feculents" });
    expect(result).toMatchObject({ action: "ambiguous", reason: "food" });
    if (result.action !== "ambiguous") return;
    expect(result.candidates.map((f) => f.id)).toContain(3);
    expect(result.items.map((i) => i.id)).toEqual([11]);
  });

  it.each([
    [{ name: "Beurre doux", quantity: 250, unit: "g" }, "several_items", [12, 13]],
    [{ name: "Œufs" }, "quantity_required", [10]],
    [{ name: "Œufs", quantity: 500, unit: "g" }, "unit_mismatch", [10]],
    [{ name: "Œufs", item_id: 99 }, "unknown_item", []],
    [{ name: "Truc", food_ref_id: 999 }, "unknown_food", []],
  ] as const)("%o → %s", (input, reason, items) => {
    expect(plan(input)).toMatchObject({ action: "ambiguous", reason });
    const result = plan(input);
    if (result.action === "ambiguous") expect(result.items.map((i) => i.id)).toEqual(items);
  });
});
