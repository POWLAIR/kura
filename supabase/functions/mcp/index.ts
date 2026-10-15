// Serveur MCP Kura : Edge Function Supabase, Streamable HTTP, clé API. Voir docs/mcp.md.
import { createApp } from "./app.ts";
import { connect } from "./db.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL manquant");

Deno.serve(createApp(connect(dbUrl)));
