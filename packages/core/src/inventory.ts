import { z } from "zod";
import {
  IdempotencyKey,
  InventoryCategory,
  InventoryLocation,
  type QuantityUnit,
  StockLevel,
} from "./schemas.ts";

type Category = z.infer<typeof InventoryCategory>;
type Location = z.infer<typeof InventoryLocation>;

// stock_movement.delta d'un article suivi en niveau (sans quantité chiffrée) :
// fraction d'un contenant plein. Un pot acheté plein puis fini en deux fois :
// achat +1, cuisine -0,5, cuisine -0,5. Même table en SQL : public.stock_level_fraction.
export const STOCK_LEVEL_FRACTION = {
  plein: 1,
  moitie: 0.5,
  presque_vide: 0.25,
} as const satisfies Record<z.infer<typeof StockLevel>, number>;

// Emplacement d'un nouvel article quand rien n'est précisé.
export const DEFAULT_LOCATION = {
  epices: "placard",
  feculents: "placard",
  sauces: "placard",
  frais: "frigo",
  fait_maison: "frigo",
} as const satisfies Record<Category, Location>;

// Unités acceptées en saisie, ramenées aux unités stockées (g, ml, pièce).
export const PurchaseUnit = z.enum(["g", "kg", "ml", "cl", "l", "piece"]);
export type PurchaseUnit = z.infer<typeof PurchaseUnit>;

const UNIT_CONVERSION = {
  g: ["g", 1],
  kg: ["g", 1000],
  ml: ["ml", 1],
  cl: ["ml", 10],
  l: ["ml", 1000],
  piece: ["piece", 1],
} as const satisfies Record<PurchaseUnit, readonly [z.infer<typeof QuantityUnit>, number]>;

export type StockAmount = { quantity: number; unit: z.infer<typeof QuantityUnit> };

export function toStockAmount(quantity: number, unit: PurchaseUnit): StockAmount {
  const [stockUnit, factor] = UNIT_CONVERSION[unit];
  // Arrondi au millième : 0,3 kg donne 300 g et non 299,99999999999994.
  return { quantity: Math.round(quantity * factor * 1000) / 1000, unit: stockUnit };
}

// ---------------------------------------------------------------------------
// Entrées des tools MCP d'inventaire (et des écrans de l'app)
// ---------------------------------------------------------------------------

const Id = z.number().int().positive();
const IsoDate = z.iso.date();

export const InventoryQuery = z.object({
  category: InventoryCategory.optional().describe("Filtrer par catégorie"),
  location: InventoryLocation.optional().describe("Filtrer par emplacement"),
  low_stock_only: z
    .boolean()
    .optional()
    .describe("Seulement les articles au seuil de rachat ou en dessous"),
});
export type InventoryQuery = z.infer<typeof InventoryQuery>;

export const PurchaseItem = z
  .object({
    name: z.string().trim().min(1).max(100).describe("Nom de l'article, ex. « Œufs »"),
    category: InventoryCategory.describe("Catégorie, utilisée si l'article est nouveau"),
    quantity: z
      .number()
      .positive()
      .optional()
      .describe("Quantité achetée ; à omettre pour un pot, une bouteille, une épice"),
    unit: PurchaseUnit.optional().describe("Unité de la quantité"),
    location: InventoryLocation.optional().describe(
      "Emplacement ; par défaut selon la catégorie (frais au frigo, le reste au placard)",
    ),
    expires_on: IsoDate.optional().describe("Date de péremption, AAAA-MM-JJ"),
    food_ref_id: Id.nullable()
      .optional()
      .describe(
        "Aliment de référence choisi parmi les candidats proposés ; null si aucun ne correspond",
      ),
    item_id: Id.optional().describe("Article existant à réapprovisionner, s'il est connu"),
  })
  .refine((i) => (i.quantity === undefined) === (i.unit === undefined), {
    message: "quantity et unit vont ensemble",
    path: ["unit"],
  });
export type PurchaseItem = z.infer<typeof PurchaseItem>;

export const AddItemsInput = z.object({
  items: z.array(PurchaseItem).min(1).max(50).describe("Articles achetés"),
  idempotency_key: IdempotencyKey.optional().describe(
    "Identifiant unique de cet enregistrement (ex. un UUID) : rejoué avec la même clé, l'appel renvoie le premier résultat sans rien réenregistrer",
  ),
});
export type AddItemsInput = z.infer<typeof AddItemsInput>;

export const ItemChanges = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    category: InventoryCategory.optional(),
    location: InventoryLocation.optional(),
    quantity: z
      .number()
      .nonnegative()
      .optional()
      .describe("Nouvelle quantité en stock, dans l'unité de l'article sauf si unit est donnée"),
    unit: PurchaseUnit.optional(),
    level: StockLevel.optional().describe("Nouveau niveau ; remplace le suivi en quantité"),
    expires_on: IsoDate.nullable().optional().describe("null efface la date"),
    restock_threshold: z
      .number()
      .nonnegative()
      .nullable()
      .optional()
      .describe("Seuil de rachat en quantité (même unité) ; null l'efface"),
    restock_level: StockLevel.nullable()
      .optional()
      .describe("Seuil de rachat en niveau ; null l'efface"),
    food_ref_id: Id.nullable().optional().describe("Aliment de référence ; null le délie"),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, { message: "Aucune modification demandée" })
  .refine((c) => c.level === undefined || (c.quantity === undefined && c.unit === undefined), {
    message: "Choisir entre quantité et niveau",
  })
  .refine((c) => c.unit === undefined || c.quantity !== undefined, {
    message: "unit s'accompagne de quantity",
    path: ["quantity"],
  });
export type ItemChanges = z.infer<typeof ItemChanges>;

export const UpdateItemInput = z.object({
  item_id: Id.describe("Id de l'article (voir get_inventory)"),
  changes: ItemChanges,
});

// Changements prêts pour public.update_item : unités ramenées à g, ml ou pièce. Une
// quantité sans unité est dans l'unité actuelle de l'article.
export type StockChanges = { [key: string]: string | number | null | undefined };

export function toStockChanges(changes: ItemChanges): StockChanges {
  const { quantity, unit, ...rest } = changes;
  if (quantity === undefined) return rest;
  return unit === undefined ? { ...rest, quantity } : { ...rest, ...toStockAmount(quantity, unit) };
}
