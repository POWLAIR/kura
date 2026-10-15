import { z } from "zod";

// Schémas partagés entre l'app Expo et le serveur MCP (voir docs/conception.md).

export const InventoryCategory = z.enum(["epices", "feculents", "sauces", "frais", "fait_maison"]);
export const InventoryLocation = z.enum(["placard", "frigo", "congelateur"]);
export const QuantityUnit = z.enum(["g", "ml", "piece"]);
export const StockLevel = z.enum(["plein", "moitie", "presque_vide"]);
export const StockMovementReason = z.enum(["achat", "cuisine", "manuel", "perime"]);
export const FoodSource = z.enum(["ciqual", "off"]);
export const EntrySource = z.enum(["manuel", "health_connect"]);

export const IdempotencyKey = z.string().min(8).max(128);
