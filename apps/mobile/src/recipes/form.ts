import { SaveRecipeInput } from "@kura/core";
import { type FormResult, parseQuantity } from "@/inventory/item-form";

// Formulaire d'une recette perso : du texte saisi à l'entrée de save_recipe (origin
// manuelle), validée par le schéma Zod de @kura/core. Sans React : testé avec Vitest.

export type IngredientUnit = "g" | "ml" | "piece" | "none";

export type IngredientForm = {
  key: string;
  name: string;
  quantity: string;
  unit: IngredientUnit;
  // Précisions choisies après une réponse ambiguë de save_recipe : un id, null (« aucun »),
  // ou absent (le serveur rapproche par le nom).
  food_ref_id?: number | null;
  item_id?: number | null;
  // Ce qui a été choisi, pour l'afficher.
  choice?: string;
};

export type RecipeForm = {
  title: string;
  servings: string;
  minutes: string;
  steps: string;
  ingredients: IngredientForm[];
};

let counter = 0;
export function emptyIngredient(): IngredientForm {
  counter += 1;
  return { key: `ingredient-${counter}`, name: "", quantity: "", unit: "g" };
}

const fail = (message: string): FormResult<never> => ({ ok: false, message });

export function recipeInput(
  form: RecipeForm,
): FormResult<Omit<SaveRecipeInput, "idempotency_key">> {
  if (!form.title.trim()) return fail("Donne un titre à la recette.");
  const servings = parseQuantity(form.servings);
  if (servings === null || !Number.isInteger(servings) || servings < 1) {
    return fail("Portions : un nombre entier, au moins 1.");
  }
  const minutes = form.minutes.trim() ? parseQuantity(form.minutes) : null;
  if (form.minutes.trim() && (minutes === null || !Number.isInteger(minutes) || minutes < 1)) {
    return fail("Temps : un nombre de minutes.");
  }
  const filled = form.ingredients.filter((i) => i.name.trim());
  if (filled.length === 0) return fail("Ajoute au moins un ingrédient.");

  const ingredients = [];
  for (const ingredient of filled) {
    const name = ingredient.name.trim();
    let amount = {};
    if (ingredient.unit !== "none") {
      const quantity = parseQuantity(ingredient.quantity);
      if (quantity === null || quantity <= 0) {
        return fail(`« ${name} » : une quantité, ou « à votre goût ».`);
      }
      amount = { quantity, unit: ingredient.unit };
    }
    ingredients.push({
      name,
      ...amount,
      ...(ingredient.food_ref_id !== undefined && { food_ref_id: ingredient.food_ref_id }),
      ...(ingredient.item_id !== undefined && { item_id: ingredient.item_id }),
    });
  }

  const parsed = SaveRecipeInput.omit({ idempotency_key: true }).safeParse({
    title: form.title.trim(),
    servings,
    ...(minutes !== null && { total_minutes: minutes }),
    steps: form.steps
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    ingredients,
    origin: "manuelle",
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : fail(parsed.error.issues[0]?.message ?? "Saisie invalide.");
}
