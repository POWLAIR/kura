// Export à sens unique de l'inventaire vers Notion. Voir docs/notion.md.
import { asUser, connect } from "../_shared/db.ts";
import { createHandler } from "./handler.ts";
import { createNotionClient } from "./notion.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const token = Deno.env.get("NOTION_TOKEN");
const cronSecret = Deno.env.get("KURA_CRON_SECRET");
if (!dbUrl || !token || !cronSecret) {
  throw new Error("SUPABASE_DB_URL, NOTION_TOKEN ou KURA_CRON_SECRET manquant");
}

const sql = connect(dbUrl);

Deno.serve(
  createHandler({
    sql,
    asUser: (userId, fn) => asUser(sql, userId, fn),
    notion: createNotionClient({ token }),
    cronSecret,
  }),
);
