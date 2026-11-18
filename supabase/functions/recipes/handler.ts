import {
  generatedToSaveInput,
  localDate,
  recipePrompt,
  type StockLine,
  SuggestRecipesInput,
  stockForRecipes,
  usesExpiring,
} from "@kura/core";
import type { Tx } from "../_shared/db.ts";
import { authenticate, errorBody, json, readInput, type SessionDeps } from "../_shared/http.ts";
import { getInventory } from "../_shared/inventory.ts";
import { errorCode, log } from "../_shared/log.ts";
import { saveRecipe } from "../_shared/recipes.ts";
import type { Generate } from "./generate.ts";

export type HandlerDeps = SessionDeps & {
  // Transaction de l'utilisateur, sous RLS (voir _shared/db.ts).
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  generate: Generate;
  today?: () => string;
};

// Recettes générées gardées une semaine si elles ne sont ni favorites ni cuisinées.
const KEEP_GENERATED_DAYS = 7;

async function cleanUp(tx: Tx) {
  await tx`
    delete from public.recipe r
    where r.origin = 'generee' and not r.is_favorite
      and r.created_at < now() - make_interval(days => ${KEEP_GENERATED_DAYS})
      and not exists (select 1 from public.meal m where m.recipe_id = r.id)`;
}

type Saved = { recipe: { id: number; ingredients: { item_id?: number }[] } };

// Recettes depuis le stock : POST /functions/v1/recipes, corps { max_minutes?, craving?,
// servings? }. Trois recettes générées par l'API Anthropic, enregistrées (origin generee)
// avec leurs ingrédients rapprochés de food_ref et de l'inventaire, valeurs par portion
// calculées depuis food_ref. Voir docs/api.md.
export function createHandler({ asUser, generate, today, ...session }: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    const caller = await authenticate(request, session);
    if (caller instanceof Response) return caller;
    const { userId, origin } = caller;

    const parsed = await readInput(request, SuggestRecipesInput, origin);
    if (parsed instanceof Response) return parsed;
    const filters = parsed.input;

    let stock: StockLine[];
    try {
      const { items } = await asUser(userId, (tx) => getInventory(tx, {}));
      stock = stockForRecipes(items, today?.() ?? localDate(new Date()));
    } catch (failure) {
      log("recipes_error", { step: "stock", code: errorCode(failure) });
      return json(500, errorBody("internal", "Erreur interne"), origin);
    }
    if (stock.length === 0) {
      return json(200, { recipes: [], notice: "Le stock est vide : rien à proposer." }, origin);
    }

    // Hors transaction : l'appel au modèle peut durer.
    let generated: Awaited<ReturnType<Generate>>;
    try {
      generated = await generate(recipePrompt(stock, filters));
    } catch (failure) {
      log("recipes_error", { step: "generate", code: errorCode(failure) });
      return json(
        502,
        errorBody(
          "generation_unavailable",
          "Pas de recettes pour l'instant : réessaie dans un moment",
        ),
        origin,
      );
    }

    try {
      const recipes = await asUser(userId, async (tx) => {
        await cleanUp(tx);
        const saved = [];
        for (const recipe of generated.recipes.slice(0, 3)) {
          const input = generatedToSaveInput(recipe, stock, `gen-${crypto.randomUUID()}`);
          if (!input) continue;
          const result = (await saveRecipe(tx, input, "lenient")) as Saved | { saved: false };
          if ("recipe" in result) saved.push(result.recipe);
        }
        return saved;
      });
      log("recipes_generated", { count: recipes.length });
      // Celles qui utilisent un produit qui périme bientôt d'abord (tri stable).
      const ranked = recipes
        .map((recipe) => ({ ...recipe, uses_expiring: usesExpiring(recipe.ingredients, stock) }))
        .sort((a, b) => Number(b.uses_expiring.length > 0) - Number(a.uses_expiring.length > 0));
      return json(200, { recipes: ranked }, origin);
    } catch (failure) {
      log("recipes_error", { step: "save", code: errorCode(failure) });
      return json(500, errorBody("internal", "Erreur interne"), origin);
    }
  };
}
