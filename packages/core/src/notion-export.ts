import {
  CATEGORY_LABELS,
  formatAmount,
  type InventoryItemView,
  LOCATION_LABELS,
} from "./inventory-view.ts";

// Export à sens unique de l'inventaire vers une base Notion en lecture seule (issue #29).
// Une page Notion par article, reconnue par sa propriété « Kura id ». Ce qui est modifié
// dans Notion n'est jamais relu : l'export réécrit les pages qui diffèrent de l'inventaire.
// Seul l'inventaire part vers Notion : ni repas, ni séances, ni pesées (conception,
// « Sécurité et données de santé »).

export const NOTION_VERSION = "2025-09-03";

export const NOTION_PROPS = {
  name: "Nom",
  location: "Emplacement",
  category: "Catégorie",
  amount: "Quantité",
  expires: "Péremption",
  restock: "À racheter",
  id: "Kura id",
} as const;

// Schéma de la base, pour la créer (script notion:setup) ou vérifier qu'elle convient.
export const NOTION_SCHEMA = {
  [NOTION_PROPS.name]: { title: {} },
  [NOTION_PROPS.location]: {
    select: { options: Object.values(LOCATION_LABELS).map((name) => ({ name })) },
  },
  [NOTION_PROPS.category]: {
    select: { options: Object.values(CATEGORY_LABELS).map((name) => ({ name })) },
  },
  [NOTION_PROPS.amount]: { rich_text: {} },
  [NOTION_PROPS.expires]: { date: {} },
  [NOTION_PROPS.restock]: { checkbox: {} },
  [NOTION_PROPS.id]: { number: { format: "number" } },
} as const;

// Ce qu'une page montre d'un article, comparable d'un côté à l'autre.
export type NotionRow = {
  id: number;
  name: string;
  location: string;
  category: string;
  amount: string;
  expires: string | null;
  restock: boolean;
};

export function rowOf(item: InventoryItemView): NotionRow {
  return {
    id: item.id,
    name: item.name,
    location: LOCATION_LABELS[item.location],
    category: CATEGORY_LABELS[item.category],
    amount: formatAmount(item),
    expires: item.expires_on ?? null,
    restock: item.low_stock === true,
  };
}

const text = (content: string) => [{ type: "text", text: { content } }];

// Propriétés d'une page Notion pour cet article.
export function notionProperties(row: NotionRow): Record<string, unknown> {
  return {
    [NOTION_PROPS.name]: { title: text(row.name) },
    [NOTION_PROPS.location]: { select: { name: row.location } },
    [NOTION_PROPS.category]: { select: { name: row.category } },
    [NOTION_PROPS.amount]: { rich_text: text(row.amount) },
    [NOTION_PROPS.expires]: { date: row.expires ? { start: row.expires } : null },
    [NOTION_PROPS.restock]: { checkbox: row.restock },
    [NOTION_PROPS.id]: { number: row.id },
  };
}

// Page Notion telle que la renvoie une requête sur la source de données (ce qui est lu).
export type NotionPage = { id: string; properties: Record<string, unknown> };

type Value = Record<string, unknown> | undefined;

function plain(value: Value, kind: "title" | "rich_text"): string {
  const parts = (value?.[kind] as { plain_text?: string }[] | undefined) ?? [];
  return parts.map((part) => part.plain_text ?? "").join("");
}

// Ce que montre une page existante, ou null si elle ne porte pas d'id Kura.
export function rowOfPage(page: NotionPage): NotionRow | null {
  const prop = (name: string) => page.properties[name] as Value;
  const id = prop(NOTION_PROPS.id)?.number;
  if (typeof id !== "number") return null;
  const select = (name: string) =>
    ((prop(name)?.select as { name?: string } | null)?.name ?? "") as string;
  return {
    id,
    name: plain(prop(NOTION_PROPS.name), "title"),
    location: select(NOTION_PROPS.location),
    category: select(NOTION_PROPS.category),
    amount: plain(prop(NOTION_PROPS.amount), "rich_text"),
    expires: (prop(NOTION_PROPS.expires)?.date as { start?: string } | null)?.start ?? null,
    restock: prop(NOTION_PROPS.restock)?.checkbox === true,
  };
}

const same = (a: NotionRow, b: NotionRow) => JSON.stringify(a) === JSON.stringify(b);

export type NotionSyncPlan = {
  create: NotionRow[];
  update: { pageId: string; row: NotionRow }[];
  // Pages de l'export sans article en face : article retiré, ou doublon.
  trash: string[];
  // Pages sans « Kura id » : jamais touchées, l'export ne les a pas créées.
  ignored: number;
};

// Le moins d'appels possible : créer ce qui manque, réécrire ce qui diffère, mettre à la
// corbeille les pages de l'export devenues inutiles. Une page identique à l'inventaire n'est
// pas touchée ; une page sans « Kura id » non plus, quelle qu'elle soit.
export function planNotionSync(items: InventoryItemView[], pages: NotionPage[]): NotionSyncPlan {
  const byId = new Map<number, { pageId: string; row: NotionRow }>();
  const plan: NotionSyncPlan = { create: [], update: [], trash: [], ignored: 0 };
  for (const page of pages) {
    const row = rowOfPage(page);
    if (row === null) plan.ignored++;
    else if (byId.has(row.id)) plan.trash.push(page.id);
    else byId.set(row.id, { pageId: page.id, row });
  }

  for (const item of items) {
    const row = rowOf(item);
    const existing = byId.get(row.id);
    byId.delete(row.id);
    if (!existing) plan.create.push(row);
    else if (!same(existing.row, row)) plan.update.push({ pageId: existing.pageId, row });
  }
  for (const { pageId } of byId.values()) plan.trash.push(pageId);
  return plan;
}

// ---------------------------------------------------------------------------
// Vérification de la base
// ---------------------------------------------------------------------------

// Propriétés d'une source de données Notion, telles que GET /v1/data_sources/{id} les
// renvoie : nom → { type }.
export type NotionSchema = Record<string, { type?: string | undefined } | undefined>;

// Écarts entre une base Notion et celle qu'attend l'export, en français ; vide si elle
// convient. L'export n'écrit jamais dans une base qui ne convient pas : on ne vide pas par
// erreur une base Notion qui n'a rien à voir.
export function schemaProblems(schema: NotionSchema): string[] {
  return Object.entries(NOTION_SCHEMA).flatMap(([name, expected]) => {
    const type = Object.keys(expected)[0];
    const actual = schema[name]?.type;
    if (actual === undefined) return [`propriété « ${name} » absente`];
    if (actual !== type) return [`propriété « ${name} » de type ${actual} au lieu de ${type}`];
    return [];
  });
}
