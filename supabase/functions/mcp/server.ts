import { McpServer } from "@modelcontextprotocol/server";
import type { Tx } from "./db.ts";
import { registerInventoryTools } from "./tools/inventory.ts";

// Requêtes de l'utilisateur authentifié : toujours sous RLS (voir asUser).
export type UserDb = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const SERVER_INFO = { name: "kura", version: "0.2.0" };

// Un serveur neuf par requête HTTP (mode sans état). Chaque tool lit et écrit via db.
export function buildServer(db: UserDb): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
  registerInventoryTools(server, db);
  return server;
}
