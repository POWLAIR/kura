// Serveur MCP Kura : Edge Function Supabase, Streamable HTTP, clé API ou OAuth 2.1 de
// Supabase Auth. Voir docs/mcp.md.

import { connect } from "../_shared/db.ts";
import { authUserFinder } from "../_shared/session.ts";
import { createApp } from "./app.ts";
import { publicBaseUrl } from "./public_url.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!dbUrl || !supabaseUrl) throw new Error("SUPABASE_DB_URL ou SUPABASE_URL manquant");

const publicUrl = publicBaseUrl(supabaseUrl);

const findUser = authUserFinder(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? null);

Deno.serve(
  createApp(connect(dbUrl), {
    findUser: (token) => findUser(token, null),
    resource: `${publicUrl}/functions/v1/mcp`,
    authorizationServer: `${publicUrl}/auth/v1`,
  }),
);
