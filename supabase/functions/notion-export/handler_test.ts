import { NOTION_PROPS, NOTION_VERSION } from "@kura/core";
import { assertEquals } from "@std/assert";
import { asUser, connect, type Sql } from "../_shared/db.ts";
import { createHandler } from "./handler.ts";
import { createNotionClient } from "./notion.ts";

const SECRET = "secret-de-test-0123456789";
const DATA_SOURCE = "0123456789abcdef0123456789abcdef";

type Page = { id: string; properties: Record<string, Record<string, unknown>> };
type Call = { method: string; path: string; body: string };

// Faux Notion : répond aux requêtes du client comme l'API (pagination, texte relu en
// plain_text, corbeille), et note tout ce qu'il reçoit.
function fakeNotion(
  options: { pageSize?: number; failWith?: number; rateLimitOnce?: boolean } = {},
) {
  const pages = new Map<string, Page>();
  const calls: Call[] = [];
  let next = 0;
  let limited = false;
  const read = (properties: Record<string, Record<string, unknown>>) =>
    Object.fromEntries(
      Object.entries(properties).map(([name, value]) => {
        for (const kind of ["title", "rich_text"]) {
          if (kind in value) {
            const parts = value[kind] as { text: { content: string } }[];
            return [name, { [kind]: parts.map((p) => ({ plain_text: p.text.content })) }];
          }
        }
        return [name, value];
      }),
    );

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/v1", "");
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", path, body });
    if (headers.get("notion-version") !== NOTION_VERSION || !headers.get("authorization")) {
      return new Response("{}", { status: 400 });
    }
    if (options.failWith) return new Response("{}", { status: options.failWith });
    if (options.rateLimitOnce && !limited) {
      limited = true;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    }
    const json = body ? JSON.parse(body) : {};
    if (path === `/data_sources/${DATA_SOURCE}/query`) {
      const all = [...pages.values()];
      const start = Number(json.start_cursor ?? 0);
      const size = options.pageSize ?? json.page_size;
      const results = all.slice(start, start + size);
      const more = start + size < all.length;
      return Response.json({
        results,
        has_more: more,
        next_cursor: more ? String(start + size) : null,
      });
    }
    if (path === "/pages" && init?.method === "POST") {
      const id = `page-${++next}`;
      pages.set(id, { id, properties: read(json.properties) });
      return Response.json({ id });
    }
    const pageId = /^\/pages\/(.+)$/.exec(path)?.[1];
    const page = pageId ? pages.get(pageId) : undefined;
    if (page && init?.method === "PATCH") {
      if (json.in_trash) pages.delete(page.id);
      else Object.assign(page.properties, read(json.properties));
      return Response.json({ id: page.id });
    }
    return new Response("{}", { status: 404 });
  };
  const names = () =>
    [...pages.values()]
      .map(
        (page) =>
          (page.properties[NOTION_PROPS.name]?.title as { plain_text: string }[] | undefined)?.[0]
            ?.plain_text,
      )
      .sort();
  return { fetchImpl, pages, calls, names };
}

async function capturingLogs<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; logs: Record<string, unknown>[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { result: await fn(), logs: lines.map((line) => JSON.parse(line)) };
  } finally {
    console.log = original;
  }
}

const noDb = (() => {
  throw new Error("pas de base dans ce test");
}) as unknown as Sql;

const post = (handler: (request: Request) => Promise<Response>, secret?: string) =>
  handler(
    new Request("http://localhost/functions/v1/notion-export", {
      method: "POST",
      headers: secret ? { "x-kura-cron": secret } : {},
    }),
  );

Deno.test("sans le secret de la tâche planifiée : rien n'est lu ni envoyé", async () => {
  const notion = fakeNotion();
  const handler = createHandler({
    sql: noDb,
    asUser: () => Promise.reject(new Error("pas de base")),
    notion: createNotionClient({ token: "t", fetchImpl: notion.fetchImpl }),
    cronSecret: SECRET,
  });
  const { logs } = await capturingLogs(async () => {
    for (const secret of [undefined, "mauvais", `${SECRET}x`]) {
      assertEquals((await post(handler, secret)).status, 401);
    }
  });
  assertEquals(notion.calls, []);
  assertEquals(logs, [
    { event: "notion_export_refused" },
    { event: "notion_export_refused" },
    { event: "notion_export_refused" },
  ]);
});

Deno.test("client Notion : pagination, attente après un 429", async () => {
  const notion = fakeNotion({ pageSize: 2, rateLimitOnce: true });
  const slept: number[] = [];
  const client = createNotionClient({
    token: "t",
    fetchImpl: notion.fetchImpl,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  for (let i = 1; i <= 5; i++) {
    await client.createPage(DATA_SOURCE, {
      [NOTION_PROPS.name]: { title: [{ type: "text", text: { content: `Article ${i}` } }] },
    });
  }
  assertEquals(slept, [1000]);
  assertEquals((await client.queryAll(DATA_SOURCE)).length, 5);
});

// Test d'intégration : handler → inventaire sous RLS → faux Notion (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "export : création, mise à jour, corbeille, rien d'autre que l'inventaire",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const user = crypto.randomUUID();
    const tag = user.slice(0, 8);
    const notion = fakeNotion();
    const handler = createHandler({
      sql,
      asUser: (userId, fn) => asUser(sql, userId, fn),
      notion: createNotionClient({ token: "t", fetchImpl: notion.fetchImpl }),
      cronSecret: SECRET,
      quietSeconds: 0,
    });
    const run = async () => {
      const { result, logs } = await capturingLogs(async () => {
        const response = await post(handler, SECRET);
        assertEquals(response.status, 200);
        return await response.json();
      });
      return { ...result, logs };
    };
    const state = async () =>
      (
        await sql<{ pending: number; last_error: string | null }[]>`
          select changes - synced_changes as pending, last_error
          from public.notion_export where user_id = ${user}`
      )[0];

    try {
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@kura.test`})`;
      let riceId = 0;
      await asUser(sql, user, async (tx) => {
        const [rice] = await tx<{ id: number }[]>`
          select public.add_item(${`Riz ${tag}`}, 'feculents', 'placard', 1500, 'g') as id`;
        riceId = rice?.id ?? 0;
        await tx`select public.add_item(${`Sel ${tag}`}, 'epices', 'placard')`;
        // Données de santé : elles ne doivent jamais partir vers Notion.
        await tx`select public.log_meal(${`Repas secret ${tag}`}, ${tx.json([{ name: "riz", food_ref_id: null, quantity: 100, unit: "g" }])}, ${`repas-${tag}`})`;
        await tx`insert into public.body_measure (measured_at, weight_kg) values (now(), 71.3)`;
        await tx`insert into public.notion_export (data_source_id, changed_at)
                 values (${DATA_SOURCE}, now() - interval '1 minute')`;
      });

      await t.step("premier export : une page par article", async () => {
        const { exported, failed, logs } = await run();
        assertEquals([exported, failed], [1, 0]);
        assertEquals(notion.names(), [`Riz ${tag}`, `Sel ${tag}`]);
        assertEquals((await state())?.pending, 0);
        assertEquals(logs, [
          { event: "notion_export_done", user_id: user, created: 2, updated: 0, trashed: 0 },
        ]);
      });

      await t.step("rien de modifié : aucun appel à Notion", async () => {
        const before = notion.calls.length;
        assertEquals((await run()).exported, 0);
        assertEquals(notion.calls.length, before);
      });

      await t.step("article modifié : seule sa page est réécrite", async () => {
        await asUser(
          sql,
          user,
          (tx) =>
            tx`select public.update_item(${riceId}::bigint, '{"quantity": 500, "restock_threshold": 1000}'::jsonb)`,
        );
        const { logs } = await run();
        assertEquals(logs[0]?.updated, 1);
        assertEquals(logs[0]?.created, 0);
        const rice = [...notion.pages.values()].find(
          (page) => (page.properties[NOTION_PROPS.id] as { number: number }).number === riceId,
        );
        assertEquals(rice?.properties[NOTION_PROPS.amount], {
          rich_text: [{ plain_text: "500 g" }],
        });
        assertEquals(rice?.properties[NOTION_PROPS.restock], { checkbox: true });
      });

      await t.step("modification faite dans Notion : réécrite au prochain export", async () => {
        const page = [...notion.pages.values()][0] as Page;
        page.properties[NOTION_PROPS.name] = { title: [{ plain_text: "Modifié dans Notion" }] };
        await asUser(
          sql,
          user,
          (tx) => tx`select public.add_item(${`Thé ${tag}`}, 'epices', 'placard')`,
        );
        await run();
        assertEquals(notion.names(), [`Riz ${tag}`, `Sel ${tag}`, `Thé ${tag}`]);
      });

      await t.step("article retiré : sa page part à la corbeille", async () => {
        await asUser(sql, user, (tx) => tx`delete from public.inventory_item where id = ${riceId}`);
        const { logs } = await run();
        assertEquals(logs[0]?.trashed, 1);
        assertEquals(notion.names(), [`Sel ${tag}`, `Thé ${tag}`]);
      });

      await t.step("aucune donnée de santé envoyée", () => {
        const sent = notion.calls.map((call) => call.body).join("\n");
        assertEquals(sent.includes(`Repas secret ${tag}`), false);
        assertEquals(sent.includes("71.3"), false);
        assertEquals(/kcal|weight|meal/i.test(sent), false);
      });

      await t.step(
        "Notion refuse : code noté, l'export reste à faire, rien dans les logs",
        async () => {
          const refusing = createHandler({
            sql,
            asUser: (userId, fn) => asUser(sql, userId, fn),
            notion: createNotionClient({
              token: "t",
              fetchImpl: fakeNotion({ failWith: 401 }).fetchImpl,
            }),
            cronSecret: SECRET,
            quietSeconds: 0,
          });
          await asUser(
            sql,
            user,
            (tx) => tx`select public.add_item(${`Café ${tag}`}, 'epices', 'placard')`,
          );
          const { result, logs } = await capturingLogs(async () =>
            (await post(refusing, SECRET)).json(),
          );
          assertEquals([result.exported, result.failed], [0, 1]);
          assertEquals(await state(), { pending: 1, last_error: "notion_401" });
          assertEquals(logs, [{ event: "notion_export_error", user_id: user, code: "notion_401" }]);
          // L'export suivant, réussi, efface l'erreur.
          await run();
          assertEquals(await state(), { pending: 0, last_error: null });
        },
      );
    } finally {
      await sql`delete from auth.users where id = ${user}`;
      await sql.end();
    }
  },
});
