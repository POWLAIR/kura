// Produit Open Food Facts par code-barres, mis en cache dans food_ref.
// Voir docs/open-food-facts.md.
import { parseOrigins } from "../_shared/cors.ts";
import { connect } from "../_shared/db.ts";
import { authUserFinder } from "../_shared/session.ts";
import { createHandler } from "./handler.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!dbUrl || !supabaseUrl) throw new Error("SUPABASE_DB_URL ou SUPABASE_URL manquant");

// En-tête HTTP : ASCII uniquement. Le secret KURA_OFF_USER_AGENT permet d'y mettre un contact.
const DEFAULT_USER_AGENT = "Kura/0.1 (app personnelle)";

Deno.serve(
  createHandler({
    findUser: authUserFinder(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? null),
    appOrigins: parseOrigins(Deno.env.get("KURA_APP_ORIGINS")),
    sql: connect(dbUrl),
    fetchOff: fetch,
    userAgent: Deno.env.get("KURA_OFF_USER_AGENT") ?? DEFAULT_USER_AGENT,
  }),
);
