// Relie l'inventaire d'un compte à une base Notion en lecture seule (issue #29).
// Voir docs/notion.md.
//
//   pnpm notion:setup --user <email> --page <lien d'une page Notion>
//     crée la base « Kura · Inventaire » sous cette page, puis la relie au compte
//   pnpm notion:setup --user <email> --data-source <id>
//     relie une source de données Notion existante, après avoir vérifié qu'elle a les
//     propriétés de l'export (sinon, refus)
//
// L'inventaire entier part au prochain passage de la tâche planifiée (une minute au plus).
import { parseArgs } from "node:util";
import { NOTION_VERSION, type NotionSchema, schemaProblems } from "@kura/core";
import { notionPageId } from "./notion";
import { createDatabaseBody, dataSourceIdOf } from "./notion-export";
import { createAdminClient, findUserId, loadEnv, requireEnv } from "./supabase";

const USAGE =
  "Usage : pnpm notion:setup --user <email> (--page <lien de page> | --data-source <id>)";

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// Une base existante n'est reliée que si elle a les propriétés de l'export : on ne relie
// pas par erreur une base Notion qui n'a rien à voir.
async function checkDataSource(dataSourceId: string, token: string): Promise<void> {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, {
    headers: notionHeaders(token),
  });
  if (response.status === 401) throw new Error("NOTION_TOKEN refusé par Notion");
  if (response.status === 403 || response.status === 404) {
    throw new Error("Base introuvable : la partager avec l'intégration Notion (⋯ → Connexions)");
  }
  if (!response.ok) throw new Error(`API Notion : HTTP ${response.status}`);
  const { properties } = (await response.json()) as { properties?: NotionSchema };
  const problems = schemaProblems(properties ?? {});
  if (problems.length > 0) {
    throw new Error(
      `Cette base n'est pas celle de l'export Kura (${problems.join(", ")}). Crée-la plutôt avec --page.`,
    );
  }
}

async function createDatabase(pageId: string, token: string): Promise<string> {
  const response = await fetch("https://api.notion.com/v1/databases", {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify(createDatabaseBody(pageId)),
  });
  if (response.status === 401) throw new Error("NOTION_TOKEN refusé par Notion");
  if (response.status === 403 || response.status === 404) {
    throw new Error("Page introuvable : la partager avec l'intégration Notion (⋯ → Connexions)");
  }
  if (!response.ok) throw new Error(`API Notion : HTTP ${response.status}`);
  return dataSourceIdOf(await response.json());
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      user: { type: "string" },
      page: { type: "string" },
      "data-source": { type: "string" },
    },
  });
  if (!values.user || Boolean(values.page) === Boolean(values["data-source"])) {
    console.error(USAGE);
    process.exit(1);
  }

  loadEnv();
  const supabase = createAdminClient();
  const userId = await findUserId(supabase, values.user);

  let dataSourceId = values["data-source"]?.replace(/-/g, "").toLowerCase() ?? "";
  if (values.page) {
    dataSourceId = await createDatabase(notionPageId(values.page), requireEnv("NOTION_TOKEN"));
    console.log("Base « Kura · Inventaire » créée dans Notion.");
  }
  if (!/^[0-9a-f]{32}$/.test(dataSourceId)) {
    throw new Error("Id de source de données Notion attendu : 32 caractères hexadécimaux");
  }
  if (values["data-source"]) await checkDataSource(dataSourceId, requireEnv("NOTION_TOKEN"));

  // Relier (ou relier à nouveau) : tout l'inventaire est à exporter.
  const { data: current, error: readError } = await supabase
    .from("notion_export")
    .select("changes")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(`Lecture de notion_export : ${readError.message}`);
  const { error } = await supabase.from("notion_export").upsert({
    user_id: userId,
    data_source_id: dataSourceId,
    changes: (current?.changes ?? 0) + 1,
    synced_changes: 0,
    changed_at: new Date(Date.now() - 60_000).toISOString(),
    last_error: null,
  });
  if (error) throw new Error(`Enregistrement de notion_export : ${error.message}`);
  console.log(`Inventaire de ${values.user} relié à la source de données ${dataSourceId}.`);
  console.log(
    "Il part vers Notion au prochain passage de la tâche planifiée (une minute au plus).",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
