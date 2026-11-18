import {
  type CookRecipeInput,
  CookStockLine,
  cookStockReport,
  createFoodMatcher,
  type Food,
  type GetRecipesInput,
  type IngredientAmbiguity,
  type InventoryLine,
  missingConversions,
  type ResolveMode,
  resolveRecipeIngredients,
  type SaveRecipeInput,
  TIMEZONE,
} from "@kura/core";
import { z } from "zod";
import type { Tx } from "./db.ts";
import { compact, InputError } from "./errors.ts";
import { CONVERSION_HINT, mealView } from "./tracking.ts";

// Recettes et « J'ai cuisiné » (issue #33), partagés par les tools MCP et l'API de l'app.
// Écriture du repas et du stock par public.cook_recipe, en une transaction (RLS).

const AMBIGUITY_HINTS: Record<IngredientAmbiguity["reason"], string> = {
  food: "Aliment de référence à choisir : relancer avec food_ref_id parmi candidates, ou food_ref_id null si aucun ne correspond.",
  unknown_food: "food_ref_id inconnu : reprendre un id parmi les candidats proposés.",
  several_items:
    "Plusieurs articles de l'inventaire correspondent : relancer avec item_id, ou item_id null si l'ingrédient ne vient pas du stock.",
  unknown_item: "item_id inconnu : voir get_inventory.",
};

const TO_ADJUST_HINT =
  "Ces articles n'ont pas été (entièrement) décomptés : demander à l'utilisateur ce qu'il en reste, puis update_item. Ne rien estimer.";

type RecipeRow = {
  id: number;
  title: string;
  origin: "generee" | "manuelle";
  servings: number;
  total_minutes: number | null;
  steps: string[];
  is_favorite: boolean;
  last_cooked: string | null;
};

const lastCooked = (tx: Tx) => tx`(
  select to_char(max(m.eaten_at) at time zone ${TIMEZONE}, 'YYYY-MM-DD')
  from public.meal m where m.recipe_id = r.id
)`;

// Recette complète : ingrédients avec leur aliment et leur article, étapes.
export async function recipeView(tx: Tx, recipeId: number) {
  const [recipe] = await tx<RecipeRow[]>`
    select r.id, r.title, r.origin, r.servings, r.total_minutes, r.steps, r.is_favorite,
      ${lastCooked(tx)} as last_cooked
    from public.recipe r where r.id = ${recipeId}`;
  if (!recipe) throw new InputError(`Recette ${recipeId} introuvable`);
  const ingredients = await tx`
    select ri.name, ri.quantity, ri.unit, ri.food_ref_id, f.name as food,
      ri.inventory_item_id as item_id, i.name as item
    from public.recipe_ingredient ri
    left join public.food_ref f on f.id = ri.food_ref_id
    left join public.inventory_item i on i.id = ri.inventory_item_id
    where ri.recipe_id = ${recipeId}
    order by ri.position, ri.id`;
  return {
    ...compact({ ...recipe, is_favorite: recipe.is_favorite || undefined }),
    ingredients: ingredients.map(compact),
  };
}

async function ingredientContext(tx: Tx) {
  const inventory = await tx<InventoryLine[]>`
    select id, name, location, food_ref_id, quantity, unit, level from public.inventory_item`;
  const foods = await tx<Food[]>`select id, code, name from public.food_ref`;
  return {
    inventory,
    foodsById: new Map(foods.map((f) => [f.id, f])),
    matchFood: createFoodMatcher(foods, { maxCandidates: 5 }),
  };
}

// Enregistre une recette. Rejouée avec la même clé, elle renvoie la recette existante.
// Mode strict : un ingrédient ambigu et rien n'est enregistré (Claude, saisie à la main).
export async function saveRecipe(tx: Tx, input: SaveRecipeInput, mode: ResolveMode = "strict") {
  const [existing] = await tx<{ id: number }[]>`
    select id from public.recipe where idempotency_key = ${input.idempotency_key}`;
  if (existing) return { replayed: true, recipe: await recipeView(tx, existing.id) };

  const { ingredients, ambiguous } = resolveRecipeIngredients(
    input.ingredients,
    await ingredientContext(tx),
    mode,
  );
  if (ambiguous.length > 0) {
    return {
      saved: false,
      hint: "Rien n'est enregistré : relancer toute la recette avec la précision demandée pour ces ingrédients.",
      ambiguous: ambiguous.map((a) => ({
        index: a.index,
        name: a.name,
        reason: a.reason,
        hint: AMBIGUITY_HINTS[a.reason],
        candidates: a.candidates.map((f) => ({ food_ref_id: f.id, name: f.name })),
        items: a.items.map((i) => ({ item_id: i.id, name: i.name, location: i.location })),
      })),
    };
  }

  const [recipe] = await tx<{ id: number }[]>`
    insert into public.recipe (title, origin, servings, total_minutes, steps, idempotency_key)
    values (
      ${input.title}, ${input.origin}, ${input.servings}, ${input.total_minutes ?? null},
      ${tx.json(input.steps)}, ${input.idempotency_key}
    )
    returning id`;
  if (!recipe) throw new Error("recipe sans id");
  const rows = ingredients.map((ingredient, position) => ({
    recipe_id: recipe.id,
    position,
    ...ingredient,
  }));
  await tx`insert into public.recipe_ingredient ${tx(
    rows,
    "recipe_id",
    "position",
    "name",
    "quantity",
    "unit",
    "food_ref_id",
    "inventory_item_id",
  )}`;
  return { replayed: false, recipe: await recipeView(tx, recipe.id) };
}

// Liste courte des recettes, les plus récentes d'abord ; ou une recette en détail.
export async function getRecipes(tx: Tx, input: GetRecipesInput) {
  if (input.recipe_id !== undefined) return { recipe: await recipeView(tx, input.recipe_id) };
  const recipes = await tx<RecipeRow[]>`
    select r.id, r.title, r.origin, r.servings, r.total_minutes, r.is_favorite,
      ${lastCooked(tx)} as last_cooked
    from public.recipe r
    where true ${input.favorites_only ? tx`and r.is_favorite` : tx``}
    order by r.is_favorite desc, r.updated_at desc
    limit 50`;
  return {
    recipes: recipes.map((r) => compact({ ...r, is_favorite: r.is_favorite || undefined })),
  };
}

const CookResult = z.object({
  meal_id: z.number(),
  replayed: z.boolean(),
  stock: z.array(CookStockLine),
});

// « J'ai cuisiné » : repas (portions mangées) et stock (portions cuisinées), d'un bloc.
export async function cookRecipe(tx: Tx, input: CookRecipeInput) {
  const [row] = await tx`
    select * from public.cook_recipe(
      ${input.recipe_id}, ${input.portions_eaten}, ${input.idempotency_key},
      ${input.portions_cooked ?? null}::numeric, ${input.eaten_at ?? null}::timestamptz)`;
  const { meal_id, replayed, stock } = CookResult.parse(row);
  const meal = await mealView(tx, meal_id);
  const missing = missingConversions(meal.items);
  // Rejoué : le stock a été décompté au premier appel, rien de plus à dire.
  const report = replayed ? null : cookStockReport(stock);
  return {
    replayed,
    meal,
    ...(report && { stock: report }),
    ...(report && report.to_adjust.length > 0 && { stock_hint: TO_ADJUST_HINT }),
    ...(missing.length > 0 && { missing_conversions: missing, hint: CONVERSION_HINT }),
  };
}
