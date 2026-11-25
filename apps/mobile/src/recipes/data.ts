import {
  type CookStockReport,
  type MealNutrition,
  type MicronutrientSummary,
  type MissingConversion,
  mealNutritionOf,
  type RecipeView,
  type SaveRecipeInput,
  type StoredMealItem,
  sumMicronutrients,
} from "@kura/core";
import { callApi } from "@/lib/api";
import { supabase } from "@/lib/supabase";

// Lectures et écritures des recettes : les opérations de l'API (mêmes que les tools MCP), et
// recipe_totals en direct (sous RLS) pour le détail des vitamines et minéraux. Les
// propositions se font dans Claude (recettes/proposer.tsx).

export type RecipeSummary = Pick<
  RecipeView,
  "id" | "title" | "origin" | "servings" | "total_minutes" | "is_favorite" | "last_cooked"
>;

export function fetchRecipes(favoritesOnly = false): Promise<{ recipes: RecipeSummary[] }> {
  return callApi("get_recipes", favoritesOnly ? { favorites_only: true } : {});
}

export async function fetchRecipe(
  id: number,
): Promise<{ recipe: RecipeView; micronutrients: MicronutrientSummary }> {
  const { recipe } = await callApi<{ recipe: RecipeView }>("get_recipes", { recipe_id: id });
  const { data, error } = await supabase.rpc("recipe_totals", { p_recipe_id: id, p_portions: 1 });
  if (error) throw error;
  const nutrition: MealNutrition = mealNutritionOf({
    nutrition_totals: data,
    partial_values: false,
  });
  return { recipe, micronutrients: sumMicronutrients([nutrition]) };
}

export type CookResult = {
  replayed: boolean;
  meal: { id: number; label: string; items: StoredMealItem[] };
  stock?: CookStockReport;
  missing_conversions?: MissingConversion[];
};

export function cookRecipe(input: {
  recipe_id: number;
  portions_eaten: number;
  portions_cooked: number;
  idempotency_key: string;
}): Promise<CookResult> {
  return callApi("cook_recipe", input);
}

export function setFavorite(
  recipeId: number,
  isFavorite: boolean,
): Promise<{ recipe: RecipeView }> {
  return callApi("set_recipe_favorite", { recipe_id: recipeId, is_favorite: isFavorite });
}

export function deleteRecipe(recipeId: number): Promise<unknown> {
  return callApi("delete_recipe", { recipe_id: recipeId });
}

// Réponse de save_recipe : la recette, ou les ingrédients à préciser (rien n'est enregistré).
export type SaveRecipeResult =
  | { replayed: boolean; recipe: RecipeView }
  | {
      saved: false;
      ambiguous: {
        index: number;
        name: string;
        reason: "food" | "unknown_food" | "several_items" | "unknown_item";
        candidates: { food_ref_id: number; name: string }[];
        items: { item_id: number; name: string; location: string }[];
      }[];
    };

export function saveRecipe(input: SaveRecipeInput): Promise<SaveRecipeResult> {
  return callApi("save_recipe", input);
}
