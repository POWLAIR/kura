import { McpServer } from "@modelcontextprotocol/server";
import type { Tx } from "./db.ts";
import { registerInventoryTools } from "./tools/inventory.ts";
import { registerTrackingTools } from "./tools/tracking.ts";

// Requêtes de l'utilisateur authentifié : toujours sous RLS (voir asUser).
export type UserDb = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const SERVER_INFO = { name: "kura", version: "0.5.0" };

// Règles communes à tous les tools, lues par Claude à la connexion (docs/conception.md).
const INSTRUCTIONS = `Kura : inventaire de cuisine et suivi (repas, sport, poids), en français.
- Les valeurs nutritionnelles viennent de Ciqual, calculées par le serveur : ne jamais les estimer, ni convertir soi-même des pièces ou des volumes en grammes.
- Quand un tool renvoie des éléments ambigus, choisir parmi les candidats ou demander à l'utilisateur, puis relancer.
- Poids d'une pièce et densités : seulement ceux que donne l'utilisateur (set_food_conversion), jamais estimés.
- Recettes : partir de get_inventory, en priorité les produits qui périment bientôt. Proposer une recette n'enregistre rien.
- Quand l'utilisateur dit avoir mangé quelque chose, et seulement alors : l'enregistrer avec log_meal, avec la part qu'il a mangée (ex. la moitié de la recette), dans les unités acceptées (pièces comme pièces : le serveur convertit et signale les valeurs partielles).
- Quand il a cuisiné à la maison : mettre aussi à jour le stock des ingrédients pris dans le stock, jamais pour un repas au restaurant ; en cas de doute, demander. update_item fixe la quantité restante : la calculer depuis get_inventory relu juste avant, moins la quantité utilisée.
- Confirmer en une phrase ; si un appel échoue en cours de route, le dire à l'utilisateur plutôt que de tout relancer.
- Pour chaque enregistrement (log_*, add_items), créer une idempotency_key unique et la réutiliser si l'appel est rejoué.
- Rester neutre : aucun commentaire sur le poids, les quantités mangées ou les calories, aucun objectif.`;

// Un serveur neuf par requête HTTP (mode sans état). Chaque tool lit et écrit via db.
export function buildServer(db: UserDb): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });
  registerInventoryTools(server, db);
  registerTrackingTools(server, db);
  return server;
}
