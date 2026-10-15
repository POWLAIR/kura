import { describe, expect, it } from "vitest";
import {
  AddItemsInput,
  ItemChanges,
  PurchaseItem,
  STOCK_LEVEL_FRACTION,
  toStockAmount,
  toStockChanges,
} from "./inventory.ts";
import { StockLevel } from "./schemas.ts";

it("donne une fraction strictement positive et décroissante pour chaque niveau", () => {
  const fractions = StockLevel.options.map((level) => STOCK_LEVEL_FRACTION[level]);
  expect(fractions).toEqual([...fractions].sort((a, b) => b - a));
  // stock_movement.delta <> 0 : un achat en niveau ne peut pas valoir 0.
  for (const f of fractions) expect(f).toBeGreaterThan(0);
});

describe("toStockAmount", () => {
  it.each([
    [1, "kg", { quantity: 1000, unit: "g" }],
    [0.3, "kg", { quantity: 300, unit: "g" }],
    [50, "cl", { quantity: 500, unit: "ml" }],
    [1.5, "l", { quantity: 1500, unit: "ml" }],
    [6, "piece", { quantity: 6, unit: "piece" }],
    [250, "g", { quantity: 250, unit: "g" }],
  ] as const)("%s %s", (quantity, unit, expected) => {
    expect(toStockAmount(quantity, unit)).toEqual(expected);
  });
});

describe("PurchaseItem", () => {
  it("accepte un achat avec ou sans quantité", () => {
    expect(
      PurchaseItem.parse({ name: " Œufs ", category: "frais", quantity: 6, unit: "piece" }),
    ).toMatchObject({ name: "Œufs" });
    expect(PurchaseItem.safeParse({ name: "Sauce soja", category: "sauces" }).success).toBe(true);
    expect(
      PurchaseItem.safeParse({ name: "Yuzu", category: "sauces", food_ref_id: null }).success,
    ).toBe(true);
  });

  it.each([
    [{ name: "Riz", category: "feculents", quantity: 1 }, "quantité sans unité"],
    [{ name: "Riz", category: "feculents", unit: "kg" }, "unité sans quantité"],
    [{ name: "Riz", category: "feculents", quantity: 0, unit: "kg" }, "quantité nulle"],
    [{ name: "", category: "feculents" }, "nom vide"],
    [{ name: "Riz", category: "cereales" }, "catégorie inconnue"],
    [{ name: "Riz", category: "feculents", expires_on: "12/10/2026" }, "date mal formée"],
  ])("refuse %o (%s)", (input, _why) => {
    expect(PurchaseItem.safeParse(input).success).toBe(false);
  });

  it("borne la liste d'articles", () => {
    expect(AddItemsInput.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("ItemChanges", () => {
  it.each([
    [{}, "aucune modification"],
    [{ quantity: 2, level: "plein" }, "quantité et niveau"],
    [{ unit: "g" }, "unité sans quantité"],
    [{ couleur: "rouge" }, "champ inconnu"],
  ])("refuse %o (%s)", (changes, _why) => {
    expect(ItemChanges.safeParse(changes).success).toBe(false);
  });

  it("accepte null pour effacer une date ou un seuil", () => {
    expect(ItemChanges.parse({ expires_on: null, restock_threshold: null })).toEqual({
      expires_on: null,
      restock_threshold: null,
    });
  });
});

describe("toStockChanges", () => {
  it("convertit la quantité dans l'unité stockée", () => {
    expect(toStockChanges({ quantity: 1.2, unit: "kg", location: "placard" })).toEqual({
      quantity: 1200,
      unit: "g",
      location: "placard",
    });
  });

  it("laisse une quantité sans unité dans l'unité de l'article", () => {
    expect(toStockChanges({ quantity: 4 })).toEqual({ quantity: 4 });
    expect(toStockChanges({ level: "moitie" })).toEqual({ level: "moitie" });
  });
});
