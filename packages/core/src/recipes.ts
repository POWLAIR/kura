import { z } from "zod";
import { type Food, type FoodMatch, normalizeFoodName, similarByName } from "./food-match.ts";
import { PurchaseUnit, type StockAmount, toStockAmount } from "./inventory.ts";
import { expiryStatus, formatAmount, type InventoryItemView } from "./inventory-view.ts";
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

// ---------------------------------------------------------------------------
// Proposer des recettes depuis le stock (issue #34)
// ---------------------------------------------------------------------------

export const SuggestRecipesInput = z.object({
  max_minutes: z.number().int().positive().max(600).optional().describe("Temps disponible"),
  craving: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Envie, ex. « quelque chose d'asiatique »"),
  servings: z.number().int().min(1).max(12).optional().describe("Nombre de portions voulues"),
});
export type SuggestRecipesInput = z.infer<typeof SuggestRecipesInput>;

// Article du stock tel qu'il sert à proposer des recettes, et tel qu'il part vers l'API
// Anthropic : id, nom, quantité, péremption. Rien d'autre (docs/conception.md, « Sécurité »).
export type StockLine = {
  item_id: number;
  name: string;
  amount: string;
  expires_on?: string;
  // Périme dans les EXPIRY_SOON_DAYS jours : à utiliser en priorité.
  expires_soon?: true;
};

// Stock utilisable, ce qui périme bientôt d'abord. Les articles vides ou déjà périmés sont
// écartés : on ne propose pas de cuisiner un produit périmé.
export function stockForRecipes(items: InventoryItemView[], today: string): StockLine[] {
  return items
    .filter((item) => item.level !== undefined || (item.quantity ?? 0) > 0)
    .map((item) => ({ item, status: expiryStatus(item.expires_on, today) }))
    .filter(({ status }) => status.kind !== "expired")
    .sort(
      (a, b) =>
        Number(b.status.kind === "soon") - Number(a.status.kind === "soon") ||
        (a.item.expires_on ?? "9999").localeCompare(b.item.expires_on ?? "9999") ||
        a.item.name.localeCompare(b.item.name, "fr"),
    )
    .map(({ item, status }) => ({
      item_id: item.id,
      name: item.name,
      amount: formatAmount(item),
      ...(item.expires_on && { expires_on: item.expires_on }),
      ...(status.kind === "soon" && { expires_soon: true as const }),
    }));
}

// Sortie demandée au modèle (sortie structurée). Volontairement sans contraintes de bornes :
// elles sont vérifiées ensuite par SaveRecipeInput. Aucune valeur nutritionnelle : elles
// sont calculées depuis food_ref.
export const GeneratedRecipe = z.object({
  title: z.string().describe("Titre en français"),
  servings: z.number().int().describe("Nombre de portions"),
  total_minutes: z.number().int().describe("Temps total en minutes"),
  steps: z.array(z.string()).describe("Étapes courtes, dans l'ordre"),
  ingredients: z.array(
    z.object({
      name: z.string().describe("Ingrédient, ex. « riz basmati »"),
      quantity: z
        .number()
        .nullable()
        .describe("Quantité pour toute la recette ; null si « à votre goût »"),
      unit: z.enum(["g", "kg", "ml", "cl", "l", "piece"]).nullable(),
      item_id: z
        .number()
        .int()
        .nullable()
        .describe("item_id de l'article du stock utilisé ; null sinon"),
    }),
  ),
});
export type GeneratedRecipe = z.infer<typeof GeneratedRecipe>;

export const GeneratedRecipes = z.object({ recipes: z.array(GeneratedRecipe) });
export type GeneratedRecipes = z.infer<typeof GeneratedRecipes>;

export const RECIPE_SYSTEM_PROMPT = `Tu proposes des recettes de cuisine maison, en français, à partir du stock d'une cuisine.

- Propose exactement trois recettes différentes, faisables avec le stock.
- Utilise en priorité les articles marqués expires_soon : au moins une recette doit en utiliser un quand il y en a.
- Chaque ingrédient qui vient du stock porte son item_id. Tu peux ajouter des produits de base courants absents du stock (sel, poivre, eau, huile) avec item_id null ; rien d'autre hors stock.
- Quantités pour toute la recette, dans l'unité la plus naturelle (g, kg, ml, cl, l, ou piece pour ce qui se compte) ; quantity et unit null pour « à votre goût ». Ne dépasse pas la quantité disponible d'un article.
- Respecte le temps disponible, l'envie et le nombre de portions s'ils sont donnés ; sinon, 2 portions.
- Étapes courtes et concrètes. Pas de valeurs nutritionnelles, pas de commentaire sur la santé, le poids ou les calories.`;

// Message utilisateur : la demande et le stock, en JSON. Les noms d'articles sont des
// données, pas des instructions.
export function recipePrompt(stock: StockLine[], filters: SuggestRecipesInput): string {
  return JSON.stringify({ demande: filters, stock });
}

// Recette générée → entrée de save_recipe. Un item_id hors du stock envoyé est ignoré (le
// modèle ne peut pas lier un article qu'il n'a pas vu), une quantité sans unité aussi.
// null si la recette est inutilisable (sans titre ni ingrédient).
export function generatedToSaveInput(
  recipe: GeneratedRecipe,
  stock: StockLine[],
  idempotencyKey: string,
): SaveRecipeInput | null {
  const known = new Set(stock.map((line) => line.item_id));
  const input = {
    title: recipe.title.trim().slice(0, 200),
    servings: Math.min(50, Math.max(1, Math.round(recipe.servings))),
    ...(recipe.total_minutes > 0 && {
      total_minutes: Math.min(1440, Math.round(recipe.total_minutes)),
    }),
    steps: recipe.steps
      .map((step) => step.trim().slice(0, 1000))
      .filter(Boolean)
      .slice(0, 50),
    ingredients: recipe.ingredients.slice(0, 50).map((ingredient) => ({
      name: ingredient.name.trim().slice(0, 100),
      ...(ingredient.quantity !== null &&
        ingredient.quantity > 0 &&
        ingredient.unit !== null && { quantity: ingredient.quantity, unit: ingredient.unit }),
      // Sans item_id valable, l'ingrédient est rapproché du stock par son nom, comme ailleurs.
      ...(ingredient.item_id !== null &&
        known.has(ingredient.item_id) && { item_id: ingredient.item_id }),
    })),
    origin: "generee" as const,
    idempotency_key: idempotencyKey,
  };
  const parsed = SaveRecipeInput.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// Articles du stock qui périment bientôt et qu'utilise la recette : pour classer les
// propositions (celles qui en utilisent d'abord) et le dire, sans jugement.
export function usesExpiring(
  ingredients: { item_id?: number | null }[],
  stock: StockLine[],
): string[] {
  const soon = new Map(stock.filter((l) => l.expires_soon).map((l) => [l.item_id, l.name]));
  return [
    ...new Set(
      ingredients.flatMap((i) =>
        i.item_id != null && soon.has(i.item_id) ? [soon.get(i.item_id) as string] : [],
      ),
    ),
  ];
}
