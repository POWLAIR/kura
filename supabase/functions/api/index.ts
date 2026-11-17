// API de l'app Kura : Edge Function Supabase, JWT de l'utilisateur. Voir docs/api.md.
import { asUser, connect } from "../_shared/db.ts";
import { authUserFinder } from "./auth.ts";
import { parseOrigins } from "./cors.ts";
import { createHandler } from "./handler.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!dbUrl || !supabaseUrl) throw new Error("SUPABASE_DB_URL ou SUPABASE_URL manquant");

const sql = connect(dbUrl);

Deno.serve(
  createHandler({
    findUser: authUserFinder(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? null),
    asUser: (userId, fn) => asUser(sql, userId, fn),
    appOrigins: parseOrigins(Deno.env.get("KURA_APP_ORIGINS")),
  }),
);
