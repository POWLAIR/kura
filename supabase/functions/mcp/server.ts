import { McpServer } from "@modelcontextprotocol/server";
import type { Tx } from "./db.ts";

// Requêtes de l'utilisateur authentifié : toujours sous RLS (voir asUser).
export type UserDb = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const SERVER_INFO = { name: "kura", version: "0.1.0" };

// Un serveur neuf par requête HTTP (mode sans état). Les tools métier arrivent avec
// #6 (inventaire) et #8 (suivi) ; chacun lira et écrira via db.
export function buildServer(_db: UserDb): McpServer {
  return new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
}
