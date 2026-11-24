import {
  type CookStockReport,
  type MealNutrition,
  type MicronutrientSummary,
  type MissingConversion,
  mealNutritionOf,
  type RecipeView,
  type StoredMealItem,
  type SuggestRecipesInput,
  sumMicronutrients,
} from "@kura/core";
import { callApi, callRecipes } from "@/lib/api";
import { supabase } from "@/lib/supabase";

// Lectures et écritures des recettes : les opérations de l'API (mêmes que les tools MCP),
// la fonction recipes pour les propositions, et recipe_totals en direct (sous RLS) pour le
// détail des vitamines et minéraux.

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

export function suggestRecipes(
  filters: SuggestRecipesInput,
): Promise<{ recipes: RecipeView[]; notice?: string }> {
  return callRecipes(filters);
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
