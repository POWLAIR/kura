import { NOTION_SCHEMA } from "@kura/core";

// Création de la base Notion qui reçoit l'export de l'inventaire (issue #29).
// Voir docs/notion.md.

export const DATABASE_TITLE = "Kura · Inventaire";

// Corps de POST /v1/databases (API 2025-09-03) : la base, sous la page donnée, avec une
// source de données aux propriétés attendues par l'export.
export function createDatabaseBody(pageId: string, title: string = DATABASE_TITLE) {
  return {
    parent: { type: "page_id", page_id: pageId },
    title: [{ type: "text", text: { content: title } }],
    icon: { type: "emoji", emoji: "🧺" },
    initial_data_source: { properties: NOTION_SCHEMA },
  };
}

// Id de la source de données dans la réponse de création, ou une erreur explicite.
export function dataSourceIdOf(response: unknown): string {
  const sources = (response as { data_sources?: { id?: unknown }[] } | null)?.data_sources;
  const id = sources?.[0]?.id;
  if (typeof id !== "string") throw new Error("Réponse de Notion sans source de données");
  return id.replace(/-/g, "");
}
