import { generateApiKey, hashApiKey, STOCK_LEVEL_FRACTION } from "@kura/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { asUser, connect } from "../db.ts";

// Test d'intégration : client MCP officiel → handler → base (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

type Item = { id: number; name: string; quantity?: number; level?: string; low_stock?: boolean };

Deno.test({
  name: "tools d'inventaire de bout en bout",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const [user, other] = [crypto.randomUUID(), crypto.randomUUID()];
    const tag = user.slice(0, 8); // noms uniques : la base locale peut contenir Ciqual
    const key = generateApiKey();
    const client = new Client({ name: "test", version: "0" });
    try {
      await sql`insert into auth.users (id, email)
                values (${user}, ${`${user}@kura.test`}), (${other}, ${`${other}@kura.test`})`;
      await sql`insert into public.api_key (user_id, label, key_prefix, key_hash)
                values (${user}, 'Test', ${key.slice(0, 12)}, ${await hashApiKey(key)})`;
      const foods = await sql<{ id: number }[]>`
        insert into public.food_ref (source, code, name) values
          ('off', ${`test-${tag}-1`}, ${`Gomasio ${tag}`}),
          ('off', ${`test-${tag}-2`}, ${`Furikake ${tag}, nature`}),
          ('off', ${`test-${tag}-3`}, ${`Furikake ${tag}, wasabi`})
        returning id`;
      // L'autre utilisateur a aussi des œufs : ils ne doivent jamais être touchés.
      await asUser(
        sql,
        other,
        (tx) => tx`select public.add_item(${`Œufs ${tag}`}, 'frais', 'frigo', 6, 'piece')`,
      );

      const app = createApp(sql);
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://localhost/functions/v1/mcp"), {
          fetch: (input, init) => app(new Request(input, init)),
          requestInit: { headers: { authorization: `Bearer ${key}` } },
        }),
      );
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name, arguments: args });
        const [first] = result.content as { type: string; text: string }[];
        const text = first?.text ?? "";
        return {
          isError: result.isError === true,
          text,
          data: result.isError ? null : JSON.parse(text),
        };
      };

      let eggs = 0;
      await t.step(
        "add_items : crée, réapprovisionne dans la même liste, signale l'ambigu",
        async () => {
          const { data } = await call("add_items", {
            items: [
              { name: `Gomasio ${tag}`, category: "epices" },
              { name: `Furikake ${tag}`, category: "epices" },
              {
                name: `Œufs ${tag}`,
                category: "frais",
                quantity: 6,
                unit: "piece",
                food_ref_id: null,
              },
              { name: `oeufs ${tag}`, category: "frais", quantity: 6, unit: "piece" },
            ],
          });
          assertEquals(
            data.created.map((i: Item) => [i.name, i.quantity ?? i.level]),
            [
              [`Gomasio ${tag}`, "plein"],
              [`Œufs ${tag}`, 12],
            ],
          );
          assertEquals(data.created[0].food.id, foods[0]?.id);
          assertEquals(data.restocked, []);
          assertEquals(data.ambiguous.length, 1);
          assertEquals(data.ambiguous[0].reason, "food");
          // Les deux variantes d'abord ; les suivants ne partagent que le tag du test.
          assertEquals(
            data.ambiguous[0].candidates
              .slice(0, 2)
              .map((c: { food_ref_id: number }) => c.food_ref_id),
            [foods[1]?.id, foods[2]?.id],
          );
          eggs = data.created[1].id;
        },
      );

      await t.step(
        "add_items : relance avec le candidat choisi, unité incompatible refusée",
        async () => {
          const { data } = await call("add_items", {
            items: [
              { name: `Furikake ${tag}`, category: "epices", food_ref_id: foods[1]?.id },
              { name: `Œufs ${tag}`, category: "frais", quantity: 0.5, unit: "kg" },
            ],
          });
          assertEquals(
            data.created.map((i: Item) => i.name),
            [`Furikake ${tag}`],
          );
          assertEquals(
            data.ambiguous.map((a: { reason: string }) => a.reason),
            ["unit_mismatch"],
          );
          assertEquals(data.ambiguous[0].items[0].item_id, eggs);
        },
      );

      await t.step("update_item puis get_shopping_list", async () => {
        const { data } = await call("update_item", {
          item_id: eggs,
          changes: { restock_threshold: 12 },
        });
        assertEquals(data.updated.low_stock, true);
        const list = await call("get_shopping_list");
        assertEquals(
          list.data.items.map((i: Item) => i.id),
          [eggs],
        );
      });

      await t.step("get_inventory filtré, et seulement les articles de l'utilisateur", async () => {
        const epices = await call("get_inventory", { category: "epices" });
        assertEquals(epices.data.items.map((i: Item) => i.name).sort(), [
          `Furikake ${tag}`,
          `Gomasio ${tag}`,
        ]);
        const all = await call("get_inventory");
        assertEquals(all.data.items.length, 3);
      });

      await t.step("add_items rejoué avec la même clé : rien n'est réenregistré", async () => {
        const args = {
          items: [{ name: `Œufs ${tag}`, category: "frais", quantity: 6, unit: "piece" }],
          idempotency_key: `courses-${tag}`,
        };
        const first = await call("add_items", args);
        const replay = await call("add_items", args);
        assertEquals(first.data.restocked[0].quantity, 18);
        assertEquals(replay.data.replayed, true);
        assertEquals(replay.data.restocked, first.data.restocked);
        const [row] = await sql`select quantity from public.inventory_item where id = ${eggs}`;
        assertEquals(row?.quantity, 18);
      });

      await t.step("update_item signale un changement d'unité", async () => {
        const { data } = await call("update_item", {
          item_id: eggs,
          changes: { quantity: 600, unit: "g" },
        });
        assertEquals(data.notice.startsWith("Suivi changé de « piece » à « g »"), true);
        assertEquals(data.updated.restock_threshold, undefined);
      });

      await t.step("erreurs de saisie renvoyées à Claude, pas en 500", async () => {
        const [theirs] = await sql<{ id: number }[]>`
          select id from public.inventory_item where user_id = ${other}`;
        const result = await call("update_item", { item_id: theirs?.id, changes: { quantity: 0 } });
        assertEquals(result.isError, true);
        assertEquals(result.text, `Article ${theirs?.id} introuvable`);
        const [{ quantity }] =
          await sql`select quantity from public.inventory_item where user_id = ${other}`;
        assertEquals(quantity, 6, "l'article de l'autre utilisateur est intact");
      });

      await t.step("STOCK_LEVEL_FRACTION concorde avec public.stock_level_fraction", async () => {
        const rows = await sql<{ level: string; fraction: number }[]>`
          select level, public.stock_level_fraction(level) as fraction
          from unnest(enum_range(null::public.stock_level)) as level`;
        assertEquals(
          Object.fromEntries(rows.map((r) => [r.level, r.fraction])),
          STOCK_LEVEL_FRACTION,
        );
      });
    } finally {
      await client.close();
      await sql`delete from auth.users where id in (${user}, ${other})`;
      await sql`delete from public.food_ref where code like ${`test-${tag}-%`}`;
      await sql.end();
    }
  },
});
