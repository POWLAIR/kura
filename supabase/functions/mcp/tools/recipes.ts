import type { McpServer } from "@modelcontextprotocol/server";
import { OPERATIONS } from "../../_shared/operations.ts";
import type { UserDb } from "../server.ts";
import { ok, userErrors } from "./result.ts";

// Tools de recettes (issue #33) : save_recipe, get_recipes, cook_recipe.
// Ici, seulement ce que lit Claude ; la logique est dans _shared/recipes.ts, partagée avec
// l'API de l'app.

export function registerRecipeTools(server: McpServer, db: UserDb): void {
  server.registerTool(
    "save_recipe",
    {
      title: "Enregistrer une recette",
      description:
        "Enregistre une recette pour pouvoir la cuisiner (cook_recipe) : titre, portions, temps, étapes et ingrédients avec la quantité pour toute la recette dans l'unité dite (g, kg, ml, cl, l, piece), sans convertir soi-même ni estimer de valeurs nutritionnelles. Chaque ingrédient est rapproché de Ciqual et de l'inventaire (item_id ; null s'il ne vient pas du stock) ; si l'un est ambigu, rien n'est enregistré et les candidats sont renvoyés. Ne pas l'appeler pour une simple proposition : seulement quand l'utilisateur choisit la recette ou la dicte. idempotency_key unique par recette.",
      inputSchema: OPERATIONS.save_recipe.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.save_recipe.run(tx, input)))),
  );

  server.registerTool(
    "get_recipes",
    {
      title: "Recettes enregistrées",
      description:
        "Liste les recettes enregistrées (favorites d'abord), ou une recette en détail avec recipe_id : ingrédients, articles du stock liés, étapes.",
      inputSchema: OPERATIONS.get_recipes.input,
      annotations: { readOnlyHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.get_recipes.run(tx, input)))),
  );

  server.registerTool(
    "cook_recipe",
    {
      title: "J'ai cuisiné",
      description:
        "À appeler quand l'utilisateur a cuisiné une recette enregistrée, et seulement alors. En une fois : le repas est enregistré pour les portions mangées (valeurs calculées depuis Ciqual), et le stock des ingrédients liés est décompté pour les portions cuisinées (par défaut toute la recette). stock.to_adjust liste les articles non décomptés (suivis en niveau, unité non convertible, stock épuisé) : demander à l'utilisateur ce qu'il en reste, puis update_item. Ne pas appeler log_meal en plus. idempotency_key unique par repas : rejoué, rien n'est décompté deux fois.",
      inputSchema: OPERATIONS.cook_recipe.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.cook_recipe.run(tx, input)))),
  );
}
