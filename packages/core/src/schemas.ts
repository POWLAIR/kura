import { z } from "zod";

// Schémas partagés entre l'app Expo et le serveur MCP (voir docs/conception.md).
// Les enums doivent rester identiques à ceux de Postgres : vérifié par schemas.test.ts.

export const FoodSource = z.enum(["ciqual", "off"]);
export const InventoryCategory = z.enum(["epices", "feculents", "sauces", "frais", "fait_maison"]);
export type InventoryCategory = z.infer<typeof InventoryCategory>;
export const InventoryLocation = z.enum(["placard", "frigo", "congelateur"]);
export type InventoryLocation = z.infer<typeof InventoryLocation>;
export const QuantityUnit = z.enum(["g", "ml", "piece"]);
export type QuantityUnit = z.infer<typeof QuantityUnit>;
export const StockLevel = z.enum(["plein", "moitie", "presque_vide"]);
export type StockLevel = z.infer<typeof StockLevel>;
export const StockMovementReason = z.enum(["achat", "cuisine", "manuel", "perime"]);
export const RecipeOrigin = z.enum(["generee", "manuelle"]);
export const EntrySource = z.enum(["manuel", "health_connect"]);

export const IdempotencyKey = z.string().min(8).max(128);
