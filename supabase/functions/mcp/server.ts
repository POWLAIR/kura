import { McpServer } from "@modelcontextprotocol/server";
import type { Tx } from "./db.ts";
import { registerInventoryTools } from "./tools/inventory.ts";
import { registerTrackingTools } from "./tools/tracking.ts";

// Requêtes de l'utilisateur authentifié : toujours sous RLS (voir asUser).
export type UserDb = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const SERVER_INFO = { name: "kura", version: "0.3.0" };

// Règles communes à tous les tools, lues par Claude à la connexion (docs/conception.md).
const INSTRUCTIONS = `Kura : inventaire de cuisine et suivi (repas, sport, poids), en français.
- Les valeurs nutritionnelles viennent de Ciqual, calculées par le serveur : ne jamais les estimer, ni convertir soi-même des pièces ou des volumes en grammes.
- Quand un tool renvoie des éléments ambigus, choisir parmi les candidats ou demander à l'utilisateur, puis relancer.
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
