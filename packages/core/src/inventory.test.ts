import { expect, it } from "vitest";
import { STOCK_LEVEL_FRACTION } from "./inventory.ts";
import { StockLevel } from "./schemas.ts";

it("donne une fraction strictement positive et décroissante pour chaque niveau", () => {
  const fractions = StockLevel.options.map((level) => STOCK_LEVEL_FRACTION[level]);
  expect(fractions).toEqual([...fractions].sort((a, b) => b - a));
  // stock_movement.delta <> 0 : un achat en niveau ne peut pas valoir 0.
  for (const f of fractions) expect(f).toBeGreaterThan(0);
});
