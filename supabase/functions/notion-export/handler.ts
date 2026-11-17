import { notionProperties, planNotionSync } from "@kura/core";
import type { Sql, Tx } from "../_shared/db.ts";
import { getInventory } from "../_shared/inventory.ts";
import { errorCode, log } from "../_shared/log.ts";
import type { NotionClient } from "./notion.ts";

export type HandlerDeps = {
  sql: Sql;
  // Transaction de l'utilisateur, sous RLS (voir _shared/db.ts).
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  notion: NotionClient;
  // Secret partagé avec la tâche pg_cron (en-tête x-kura-cron).
  cronSecret: string;
  // Attente de la fin d'une rafale de modifications ; 0 pour les tests.
  quietSeconds?: number;
};

// Comparaison en temps constant : le secret ne se devine pas caractère par caractère.
function sameSecret(a: string, b: string): boolean {
  const [x, y] = [new TextEncoder().encode(a), new TextEncoder().encode(b)];
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

type Due = { user_id: string; data_source_id: string; changes: number };

// Aligne la base Notion d'un utilisateur sur son inventaire. Rien n'est relu dans Notion
// sinon l'id Kura de chaque page : une modification faite dans Notion est réécrite.
async function exportOne(deps: HandlerDeps, due: Due) {
  const { items } = await deps.asUser(due.user_id, (tx) => getInventory(tx, {}));
  const plan = planNotionSync(items, await deps.notion.queryAll(due.data_source_id));
  for (const row of plan.create) {
    await deps.notion.createPage(due.data_source_id, notionProperties(row));
  }
  for (const { pageId, row } of plan.update) {
    await deps.notion.updatePage(pageId, notionProperties(row));
  }
  for (const pageId of plan.trash) await deps.notion.trashPage(pageId);
  return { created: plan.create.length, updated: plan.update.length, trashed: plan.trash.length };
}

// Export à sens unique : POST /functions/v1/notion-export, appelé par pg_cron avec le
// secret partagé. Exporte chaque inventaire modifié, une base Notion après l'autre.
export function createHandler(deps: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!sameSecret(request.headers.get("x-kura-cron") ?? "", deps.cronSecret)) {
      log("notion_export_refused", {});
      return new Response(null, { status: 401 });
    }

    // Seule lecture hors RLS : la liste des inventaires à exporter, tous utilisateurs.
    const due = await deps.sql<Due[]>`
      select * from public.notion_exports_due(make_interval(secs => ${deps.quietSeconds ?? 15}))`;

    let exported = 0;
    let failed = 0;
    for (const entry of due) {
      try {
        const counts = await exportOne(deps, entry);
        // Exporté jusqu'à la modification vue au départ : celles arrivées depuis restent dues.
        await deps.sql`
          update public.notion_export
          set synced_changes = greatest(synced_changes, ${entry.changes}),
              synced_at = now(), last_error = null
          where user_id = ${entry.user_id}`;
        log("notion_export_done", { user_id: entry.user_id, ...counts });
        exported++;
      } catch (failure) {
        // Un code seulement : ni nom d'article ni contenu de la base.
        const code = errorCode(failure);
        await deps.sql`
          update public.notion_export set last_error = ${code} where user_id = ${entry.user_id}`;
        log("notion_export_error", { user_id: entry.user_id, code });
        failed++;
      }
    }
    return Response.json({ exported, failed });
  };
}
