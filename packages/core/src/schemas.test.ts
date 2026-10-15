import { describe, expect, it } from "vitest";
import { InventoryLocation, StockLevel } from "./schemas";

describe("schémas", () => {
  it("accepte les emplacements connus", () => {
    expect(InventoryLocation.parse("frigo")).toBe("frigo");
  });

  it("refuse un niveau inconnu", () => {
    expect(StockLevel.safeParse("vide").success).toBe(false);
  });
});
