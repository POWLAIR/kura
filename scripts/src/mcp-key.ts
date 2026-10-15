// Clés API du connecteur MCP (issue #5). Voir docs/mcp.md.
//
//   pnpm mcp:key --user <email> [--label <nom>]   crée une clé, affichée une seule fois
//   pnpm mcp:key --revoke <début de clé>          révoque une clé (ex. kura_AbCdEfG)
//
// Seul le hash SHA-256 est enregistré dans api_key.
import { parseArgs } from "node:util";
import { API_KEY_VISIBLE_LENGTH, generateApiKey, hashApiKey } from "@kura/core";
import { createAdminClient, findUserId, loadEnv } from "./supabase";

const USAGE =
  "Usage : pnpm mcp:key --user <email> [--label <nom>]  |  pnpm mcp:key --revoke <début de clé>";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      user: { type: "string" },
      label: { type: "string", default: "Claude" },
      revoke: { type: "string" },
    },
  });
  if (Boolean(values.user) === Boolean(values.revoke)) {
    console.error(USAGE);
    process.exit(1);
  }

  loadEnv();
  const supabase = createAdminClient();

  if (values.revoke) {
    const { data, error } = await supabase
      .from("api_key")
      .select("id, label")
      .eq("key_prefix", values.revoke)
      .is("revoked_at", null);
    if (error) throw new Error(`Lecture des clés : ${error.message}`);
    const [key, ...others] = data;
    if (!key) throw new Error(`Aucune clé active ne commence par ${values.revoke}`);
    if (others.length > 0)
      throw new Error(`Plusieurs clés actives commencent par ${values.revoke}`);
    const { error: revokeError } = await supabase
      .from("api_key")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", key.id);
    if (revokeError) throw new Error(`Révocation : ${revokeError.message}`);
    console.log(`Clé « ${key.label} » (${values.revoke}…) révoquée.`);
    return;
  }

  const userId = await findUserId(supabase, values.user as string);
  const key = generateApiKey();
  const { error } = await supabase.from("api_key").insert({
    user_id: userId,
    label: values.label,
    key_prefix: key.slice(0, API_KEY_VISIBLE_LENGTH),
    key_hash: await hashApiKey(key),
  });
  if (error) throw new Error(`Création de la clé : ${error.message}`);
  console.log(`Clé « ${values.label} » créée. Copie-la maintenant, elle ne sera plus affichée :\n`);
  console.log(`  ${key}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
