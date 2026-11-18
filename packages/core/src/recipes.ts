import { z } from "zod";
import { type Food, type FoodMatch, normalizeFoodName, similarByName } from "./food-match.ts";
import { PurchaseUnit, type StockAmount, toStockAmount } from "./inventory.ts";
import type { InventoryLine } from "./purchase.ts";
import { IdempotencyKey, RecipeOrigin } from "./schemas.ts";

// Recettes et « J'ai cuisiné » (docs/conception.md, « Recettes », « Modèle de données »).
// Les valeurs nutritionnelles viennent de food_ref, calculées en SQL : jamais du modèle.

const Id = z.number().int().positive();
// Avec fuseau obligatoire, comme pour les repas.
const IsoDateTime = z.iso.datetime({ offset: true });
const Portions = z.number().positive().max(50);

export const RecipeIngredientInput = z
  .object({
    name: z.string().trim().min(1).max(100).describe("Ingrédient tel que dit, ex. « riz basmati »"),
    quantity: z
      .number()
      .positive()
      .optional()
      .describe("Quantité pour toute la recette, dans l'unité dite ; absente pour « sel, poivre »"),
    unit: PurchaseUnit.optional().describe(
      "Unité dite (g, kg, ml, cl, l, piece) : ne pas convertir soi-même en grammes",
    ),
    food_ref_id: Id.nullable()
      .optional()
      .describe("Aliment de référence choisi parmi les candidats ; null si aucun ne correspond"),
    item_id: Id.nullable()
      .optional()
      .describe(
        "Article de l'inventaire utilisé (get_inventory) ; null si l'ingrédient ne vient pas du stock",
      ),
  })
  .refine((i) => (i.quantity === undefined) === (i.unit === undefined), {
    message: "quantity et unit vont ensemble",
  });
export type RecipeIngredientInput = z.infer<typeof RecipeIngredientInput>;

export const SaveRecipeInput = z.object({
  title: z.string().trim().min(1).max(200).describe("Titre, ex. « Riz sauté aux œufs »"),
  servings: z.number().int().min(1).max(50).describe("Nombre de portions de la recette"),
  total_minutes: z.number().int().positive().max(1440).optional().describe("Temps total"),
  steps: z.array(z.string().trim().min(1).max(1000)).max(50).describe("Étapes, dans l'ordre"),
  ingredients: z
    .array(RecipeIngredientInput)
    .min(1)
    .max(50)
    .describe("Ingrédients, quantités pour toute la recette"),
  origin: RecipeOrigin.default("generee").describe(
    "generee : proposée par Claude ; manuelle : dictée ou saisie par l'utilisateur",
  ),
  idempotency_key: IdempotencyKey.describe("Identifiant unique de cette recette (ex. un UUID)"),
});
export type SaveRecipeInput = z.infer<typeof SaveRecipeInput>;

export const CookRecipeInput = z
  .object({
    recipe_id: Id.describe("Recette enregistrée (save_recipe, get_recipes)"),
    portions_eaten: Portions.describe("Portions mangées : comptées dans le repas"),
    portions_cooked: Portions.optional().describe(
      "Portions cuisinées : décomptées du stock ; par défaut toute la recette",
    ),
    eaten_at: IsoDateTime.optional().describe("Date-heure ISO avec fuseau ; par défaut maintenant"),
    idempotency_key: IdempotencyKey.describe(
      "Identifiant unique de ce repas : rejoué avec la même clé, rien n'est décrémenté deux fois",
    ),
  })
  .refine((c) => c.portions_cooked === undefined || c.portions_eaten <= c.portions_cooked, {
    message: "Plus de portions mangées que de portions cuisinées",
  });
export type CookRecipeInput = z.infer<typeof CookRecipeInput>;

export const GetRecipesInput = z.object({
  recipe_id: Id.optional().describe("Une recette en détail : ingrédients, étapes"),
  favorites_only: z.boolean().optional().describe("Seulement les favorites"),
});
export type GetRecipesInput = z.infer<typeof GetRecipesInput>;

// ---------------------------------------------------------------------------
// Ingrédients : rapprochement de food_ref et de l'inventaire
// ---------------------------------------------------------------------------

export type ResolvedIngredient = {
  name: string;
  quantity: number | null;
  unit: StockAmount["unit"] | null;
  food_ref_id: number | null;
  inventory_item_id: number | null;
};

export type IngredientAmbiguity = {
  index: number;
  name: string;
  reason: "food" | "unknown_food" | "several_items" | "unknown_item";
  candidates: Food[];
  items: InventoryLine[];
};

export type IngredientContext = {
  inventory: InventoryLine[];
  foodsById: Map<number, Food>;
  matchFood: (name: string) => FoodMatch;
};

// strict : un doute renvoie de quoi trancher et rien n'est enregistré (Claude, saisie à la
// main). lenient : un doute laisse le lien vide, pour une recette générée qu'on ne peut pas
// redemander ; l'ingrédient compte alors comme « valeurs partielles », sans rien deviner.
export type ResolveMode = "strict" | "lenient";

export function resolveRecipeIngredients(
  ingredients: RecipeIngredientInput[],
  ctx: IngredientContext,
  mode: ResolveMode = "strict",
): { ingredients: ResolvedIngredient[]; ambiguous: IngredientAmbiguity[] } {
  const resolved: ResolvedIngredient[] = [];
  const ambiguous: IngredientAmbiguity[] = [];

  for (const [index, input] of ingredients.entries()) {
    const fail = (
      reason: IngredientAmbiguity["reason"],
      { candidates = [], items = [] }: { candidates?: Food[]; items?: InventoryLine[] } = {},
    ) => ambiguous.push({ index, name: input.name, reason, candidates, items });

    // Article de l'inventaire : choisi, exclu, ou retrouvé par le nom.
    let item: InventoryLine | null | undefined;
    if (input.item_id === null) {
      item = null;
    } else if (input.item_id !== undefined) {
      item = ctx.inventory.find((i) => i.id === input.item_id);
      if (!item) {
        fail("unknown_item");
        continue;
      }
    } else {
      const name = normalizeFoodName(input.name);
      const sameName = ctx.inventory.filter((i) => normalizeFoodName(i.name) === name);
      if (sameName.length === 1) item = sameName[0];
      else if (sameName.length > 1) {
        if (mode === "strict") {
          fail("several_items", { items: sameName });
          continue;
        }
        item = null;
      }
    }

    // Aliment de référence : choisi, exclu, celui de l'article lié, ou rapproché par le nom.
    let foodId: number | null;
    if (input.food_ref_id === null) {
      foodId = null;
    } else if (input.food_ref_id !== undefined) {
      if (!ctx.foodsById.has(input.food_ref_id)) {
        fail("unknown_food");
        continue;
      }
      foodId = input.food_ref_id;
    } else if (item) {
      // L'article a déjà tranché à l'achat (add_items), y compris « aucune référence ».
      foodId = item.food_ref_id;
    } else {
      const match = ctx.matchFood(input.name);
      if (match.status === "matched") {
        foodId = match.food.id;
      } else if (mode === "strict") {
        fail("food", {
          candidates: match.status === "unmatched" ? match.candidates : [],
          items: item ? [] : similarByName(input.name, ctx.inventory),
        });
        continue;
      } else {
        foodId = null;
      }
    }

    // Même aliment sous un autre nom (« Riz » pour « riz basmati ») : même article.
    if (item === undefined && foodId !== null) {
      const sameFood = ctx.inventory.filter((i) => i.food_ref_id === foodId);
      if (sameFood.length === 1) item = sameFood[0];
      else if (sameFood.length > 1 && mode === "strict") {
        fail("several_items", { items: sameFood });
        continue;
      }
    }

    const amount =
      input.quantity !== undefined && input.unit !== undefined
        ? toStockAmount(input.quantity, input.unit)
        : null;
    resolved.push({
      name: input.name,
      quantity: amount?.quantity ?? null,
      unit: amount?.unit ?? null,
      food_ref_id: foodId,
      inventory_item_id: item?.id ?? null,
    });
  }
  return { ingredients: resolved, ambiguous };
}

// ---------------------------------------------------------------------------
// Stock après « J'ai cuisiné »
// ---------------------------------------------------------------------------

// Statuts renvoyés par public.cook_recipe, un par ingrédient lié à l'inventaire.
export const CookStockStatus = z.enum([
  "decremented",
  "insufficient",
  "empty",
  "level",
  "no_quantity",
  "no_conversion",
]);
export type CookStockStatus = z.infer<typeof CookStockStatus>;

export const CookStockLine = z.object({
  ingredient: z.string(),
  item_id: z.number(),
  item: z.string(),
  status: CookStockStatus,
  delta: z.number().optional(),
  unit: z.enum(["g", "ml", "piece"]).optional(),
});
export type CookStockLine = z.infer<typeof CookStockLine>;

// Pourquoi un article n'a pas été (entièrement) décrémenté, en clair pour l'utilisateur.
export const STOCK_TO_ADJUST: Record<Exclude<CookStockStatus, "decremented">, string> = {
  insufficient: "le stock est arrivé à 0 avant la quantité de la recette",
  empty: "l'article était déjà à 0",
  level: "article suivi en niveau",
  no_quantity: "ingrédient sans quantité",
  no_conversion: "unité de la recette impossible à convertir dans celle de l'article",
};

export type CookStockReport = {
  decremented: { item_id: number; item: string; used: number; unit: string }[];
  to_adjust: { item_id: number; item: string; ingredient: string; reason: string }[];
};

// Sépare ce qui a été décompté de ce qui reste à ajuster à la main (D3).
export function cookStockReport(lines: CookStockLine[]): CookStockReport {
  const report: CookStockReport = { decremented: [], to_adjust: [] };
  for (const line of lines) {
    if (line.delta !== undefined && line.unit !== undefined) {
      report.decremented.push({
        item_id: line.item_id,
        item: line.item,
        used: line.delta,
        unit: line.unit,
      });
    }
    if (line.status !== "decremented") {
      report.to_adjust.push({
        item_id: line.item_id,
        item: line.item,
        ingredient: line.ingredient,
        reason: STOCK_TO_ADJUST[line.status],
      });
    }
  }
  return report;
}
