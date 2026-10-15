import type { z } from "zod";
import { type Food, type FoodMatch, normalizeFoodName, similarByName } from "./food-match.ts";
import {
  DEFAULT_LOCATION,
  type PurchaseItem,
  type StockAmount,
  toStockAmount,
} from "./inventory.ts";
import type { InventoryCategory, InventoryLocation, QuantityUnit, StockLevel } from "./schemas.ts";

// Décide, pour chaque article acheté, s'il réapprovisionne un article existant, en crée un
// nouveau, ou reste ambigu. Rien n'est deviné : en cas de doute, on renvoie de quoi
// trancher (candidats food_ref, articles existants) et l'appelant redemande.

type Location = z.infer<typeof InventoryLocation>;

export type InventoryLine = {
  id: number;
  name: string;
  location: Location;
  food_ref_id: number | null;
  quantity: number | null;
  unit: z.infer<typeof QuantityUnit> | null;
  level: z.infer<typeof StockLevel> | null;
};

export type AmbiguityReason =
  | "food" // aliment de référence à choisir parmi les candidats (ou null)
  | "several_items" // plusieurs articles existants correspondent : préciser item_id
  | "quantity_required" // article suivi en quantité : combien ?
  | "unit_mismatch" // article suivi dans une autre unité
  | "unknown_item" // item_id absent de l'inventaire
  | "unknown_food"; // food_ref_id absent du référentiel

export type PurchasePlan =
  | { action: "restock"; item: InventoryLine; amount: StockAmount | null; expiresOn: string | null }
  | {
      action: "create";
      name: string;
      category: z.infer<typeof InventoryCategory>;
      location: Location;
      amount: StockAmount | null;
      food: Food | null;
      expiresOn: string | null;
    }
  | { action: "ambiguous"; reason: AmbiguityReason; candidates: Food[]; items: InventoryLine[] };

export type PurchaseContext = {
  inventory: InventoryLine[];
  foodsById: Map<number, Food>;
  matchFood: (name: string) => FoodMatch;
};

function ambiguous(
  reason: AmbiguityReason,
  { candidates = [], items = [] }: { candidates?: Food[]; items?: InventoryLine[] } = {},
): PurchasePlan {
  return { action: "ambiguous", reason, candidates, items };
}

// Suivi en niveau : un achat remet l'article à plein, la quantité achetée importe peu.
// Suivi en quantité : il faut une quantité dans la même unité.
function restock(
  item: InventoryLine,
  amount: StockAmount | null,
  expiresOn: string | null,
): PurchasePlan {
  if (item.level !== null) return { action: "restock", item, amount: null, expiresOn };
  if (!amount) return ambiguous("quantity_required", { items: [item] });
  if (amount.unit !== item.unit) return ambiguous("unit_mismatch", { items: [item] });
  return { action: "restock", item, amount, expiresOn };
}

export function planPurchase(input: PurchaseItem, ctx: PurchaseContext): PurchasePlan {
  const amount =
    input.quantity !== undefined && input.unit !== undefined
      ? toStockAmount(input.quantity, input.unit)
      : null;
  const expiresOn = input.expires_on ?? null;
  const one = (items: InventoryLine[]) =>
    items.length === 1 && items[0]
      ? restock(items[0], amount, expiresOn)
      : ambiguous("several_items", { items });

  if (input.item_id !== undefined) {
    const item = ctx.inventory.find((i) => i.id === input.item_id);
    return item ? restock(item, amount, expiresOn) : ambiguous("unknown_item");
  }

  // Un article déjà en stock sous ce nom (au même emplacement si précisé) est
  // réapprovisionné plutôt que dupliqué.
  const atLocation = (i: InventoryLine) =>
    input.location === undefined || i.location === input.location;
  const name = normalizeFoodName(input.name);
  const sameName = ctx.inventory.filter((i) => atLocation(i) && normalizeFoodName(i.name) === name);
  if (sameName.length > 0) return one(sameName);

  let food: Food | null = null;
  if (input.food_ref_id !== undefined && input.food_ref_id !== null) {
    const chosen = ctx.foodsById.get(input.food_ref_id);
    if (!chosen) return ambiguous("unknown_food");
    food = chosen;
  } else if (input.food_ref_id === undefined) {
    const match = ctx.matchFood(input.name);
    if (match.status !== "matched") {
      return ambiguous("food", {
        candidates: match.status === "unmatched" ? match.candidates : [],
        items: similarByName(input.name, ctx.inventory.filter(atLocation)),
      });
    }
    food = match.food;
  }

  // Même aliment sous un autre nom (« Riz » pour « Riz long ») : même article.
  const linked = food;
  if (linked) {
    const sameFood = ctx.inventory.filter((i) => atLocation(i) && i.food_ref_id === linked.id);
    if (sameFood.length > 0) return one(sameFood);
  }

  return {
    action: "create",
    name: input.name,
    category: input.category,
    location: input.location ?? DEFAULT_LOCATION[input.category],
    amount,
    food,
    expiresOn,
  };
}
