import { McpServer } from "@modelcontextprotocol/server";
import type { Tx } from "../_shared/db.ts";
import { registerPrompts } from "./prompts.ts";
import { registerInventoryTools } from "./tools/inventory.ts";
import { registerRecipeTools } from "./tools/recipes.ts";
import { registerTrackingTools } from "./tools/tracking.ts";

// Requêtes de l'utilisateur authentifié : toujours sous RLS (voir asUser).
export type UserDb = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const SERVER_INFO = { name: "kura", version: "0.10.0" };

// Règles communes à tous les tools, lues par Claude à la connexion (docs/conception.md).
const INSTRUCTIONS = `Kura : inventaire de cuisine et suivi (repas, sport, poids), en français.
- Les valeurs nutritionnelles viennent de Ciqual, calculées par le serveur : ne jamais les estimer, ni convertir soi-même des pièces ou des volumes en grammes.
- Quand un tool renvoie des éléments ambigus, choisir parmi les candidats ou demander à l'utilisateur, puis relancer.
- Poids d'une pièce et densités : seulement ceux que donne l'utilisateur (set_food_conversion), jamais estimés.
- Recettes : partir de suggest_recipes (stock trié par péremption), en priorité les produits qui périment bientôt. Proposer une recette n'enregistre rien ; quand l'utilisateur en choisit une ou dicte la sienne, l'enregistrer avec save_recipe.
- Quand il a cuisiné une recette à la maison : cook_recipe, avec les portions mangées (et cuisinées si ce n'est pas toute la recette). Il enregistre le repas et décompte le stock d'un bloc : ne pas appeler log_meal ni update_item en plus, sauf pour les articles de stock.to_adjust, après avoir demandé ce qu'il en reste.
- Quand il dit avoir mangé autre chose (restaurant, plat acheté, en-cas), et seulement alors : log_meal, avec la part qu'il a mangée, dans les unités acceptées (pièces comme pièces : le serveur convertit et signale les valeurs partielles). Le stock n'est pas touché ; s'il a pris des produits du stock, demander, puis update_item depuis get_inventory relu juste avant.
- Confirmer en une phrase ; si un appel échoue en cours de route, le dire à l'utilisateur plutôt que de tout relancer.
- Pour chaque enregistrement (log_*, add_items, save_recipe, cook_recipe), créer une idempotency_key unique et la réutiliser si l'appel est rejoué.
- Rester neutre : aucun commentaire sur le poids, les quantités mangées ou les calories, aucun objectif.`;

// Un serveur neuf par requête HTTP (mode sans état). Chaque tool lit et écrit via db ; les
// prompts n'écrivent rien.
export function buildServer(db: UserDb): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, prompts: {} },
    instructions: INSTRUCTIONS,
  });
  registerInventoryTools(server, db);
  registerTrackingTools(server, db);
  registerRecipeTools(server, db);
  registerPrompts(server);
  return server;
}
