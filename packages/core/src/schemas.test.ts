import { describe, expect, it } from "vitest";
import { Constants } from "./database.types.ts";
import {
  EntrySource,
  FoodSource,
  IdempotencyKey,
  InventoryCategory,
  InventoryLocation,
  QuantityUnit,
  RecipeOrigin,
  StockLevel,
  StockMovementReason,
} from "./schemas.ts";

describe("schémas", () => {
  it("accepte les emplacements connus", () => {
    expect(InventoryLocation.parse("frigo")).toBe("frigo");
  });

  it("refuse un niveau inconnu", () => {
    expect(StockLevel.safeParse("vide").success).toBe(false);
  });

  it("borne la clé d'idempotence comme la base (8 à 128 caractères)", () => {
    expect(IdempotencyKey.safeParse("court").success).toBe(false);
    expect(IdempotencyKey.safeParse("cle-repas-0001").success).toBe(true);
    expect(IdempotencyKey.safeParse("x".repeat(129)).success).toBe(false);
  });
});

describe("alignement avec les enums Postgres", () => {
  const enums = Constants.public.Enums;

  it.each([
    ["food_source", FoodSource, enums.food_source],
    ["inventory_category", InventoryCategory, enums.inventory_category],
    ["inventory_location", InventoryLocation, enums.inventory_location],
    ["quantity_unit", QuantityUnit, enums.quantity_unit],
    ["stock_level", StockLevel, enums.stock_level],
    ["stock_movement_reason", StockMovementReason, enums.stock_movement_reason],
    ["recipe_origin", RecipeOrigin, enums.recipe_origin],
    ["entry_source", EntrySource, enums.entry_source],
  ] as const)("%s", (_, schema, dbValues) => {
    expect(schema.options).toEqual([...dbValues]);
  });

  it("couvre tous les enums de la base", () => {
    expect(Object.keys(enums)).toHaveLength(8);
  });
});
