import { NOTION_VERSION, type NotionPage, type NotionSchema } from "@kura/core";

// Client minimal de l'API Notion pour l'export de l'inventaire. Seuls l'inventaire et l'id
// de la source de données partent vers Notion.

export class NotionError extends Error {
  code: string;
  constructor(status: number) {
    super("Notion a refusé la requête");
    this.name = "NotionError";
    this.code = `notion_${status}`;
  }
}

export type NotionClient = {
  // Propriétés de la source de données : nom → { type }.
  schema: (dataSourceId: string) => Promise<NotionSchema>;
  queryAll: (dataSourceId: string) => Promise<NotionPage[]>;
  createPage: (dataSourceId: string, properties: Record<string, unknown>) => Promise<void>;
  updatePage: (pageId: string, properties: Record<string, unknown>) => Promise<void>;
  trashPage: (pageId: string) => Promise<void>;
};

export type NotionClientOptions = {
  token: string;
  fetchImpl?: typeof fetch;
  // Attente entre deux tentatives après un 429 ; injectable pour les tests.
  sleep?: (ms: number) => Promise<void>;
};

const API = "https://api.notion.com/v1";
const MAX_RETRIES = 3;

export function createNotionClient({
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: NotionClientOptions): NotionClient {
  // Notion limite à environ trois requêtes par seconde : au-delà, il répond 429 avec
  // Retry-After (en secondes). On attend, puis on réessaie.
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "notion-version": NOTION_VERSION,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new NotionError(response.status);
      }
      return await response.json();
    }
  }

  return {
    async schema(dataSourceId) {
      const result = (await call("GET", `/data_sources/${dataSourceId}`)) as {
        properties?: NotionSchema;
      };
      return result.properties ?? {};
    },
    async queryAll(dataSourceId) {
      const pages: NotionPage[] = [];
      let cursor: string | null = null;
      do {
        const result = (await call("POST", `/data_sources/${dataSourceId}/query`, {
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        })) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null };
        pages.push(...result.results.map(({ id, properties }) => ({ id, properties })));
        cursor = result.has_more ? result.next_cursor : null;
      } while (cursor);
      return pages;
    },
    async createPage(dataSourceId, properties) {
      await call("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties,
      });
    },
    async updatePage(pageId, properties) {
      await call("PATCH", `/pages/${pageId}`, { properties });
    },
    async trashPage(pageId) {
      await call("PATCH", `/pages/${pageId}`, { in_trash: true });
    },
  };
}
