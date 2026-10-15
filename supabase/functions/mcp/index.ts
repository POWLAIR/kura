// Serveur MCP Kura (issue #5) : Edge Function Supabase, Streamable HTTP, clé API.
// Voir docs/mcp.md.
import { asUser, connect, findCaller } from "./db.ts";
import { createHandler } from "./handler.ts";
import { buildServer } from "./server.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL manquant");
const sql = connect(dbUrl);

Deno.serve(
  createHandler({
    findCaller: (keyHash) => findCaller(sql, keyHash),
    buildServer: (caller) => buildServer((fn) => asUser(sql, caller.userId, fn)),
  }),
);
