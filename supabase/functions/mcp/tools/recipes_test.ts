import { generateApiKey, hashApiKey } from "@kura/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertEquals } from "@std/assert";
import { connect } from "../../_shared/db.ts";
import { createApp } from "../app.ts";

// Test d'intégration : client MCP officiel → handler → base (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "tools de recettes de bout en bout",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const user = crypto.randomUUID();
    const tag = user.slice(0, 8); // noms et clés uniques : la base locale peut contenir Ciqual
    const key = generateApiKey();
    const client = new Client({ name: "test", version: "0" });
    const logged: string[] = [];
    const consoleLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@kura.test`})`;
      await sql`insert into public.api_key (user_id, label, key_prefix, key_hash)
                values (${user}, 'Test', ${key.slice(0, 12)}, ${await hashApiKey(key)})`;
      const [riz, , oeuf] = await sql<{ id: number }[]>`
        insert into public.food_ref (source, code, name, energy_kcal, piece_weight_g)
        values
          ('off', ${`test-${tag}-1`}, ${`Riz ${tag}, basmati, cru`}, 350, null),
          ('off', ${`test-${tag}-2`}, ${`Riz ${tag}, complet, cru`}, 340, null),
          ('off', ${`test-${tag}-3`}, ${`Oeuf ${tag}, cru`}, 140, 60)
        returning id`;

      const app = createApp(sql);
      await client.connect(
        new StreamableHTTPClientTransport(new URL("http://localhost/functions/v1/mcp"), {
          fetch: (input, init) => app(new Request(input, init)),
          requestInit: { headers: { authorization: `Bearer ${key}` } },
        }),
      );
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        const [first] = result.content as { text: string }[];
        return result.isError ? { error: first?.text } : JSON.parse(first?.text ?? "null");
      };
      const quantity = async (name: string) =>
        (
          await sql<{ quantity: number }[]>`
          select quantity from public.inventory_item where user_id = ${user} and name = ${name}`
        )[0]?.quantity;

      await call("add_items", {
        items: [
          {
            name: `Riz ${tag}`,
            category: "feculents",
            quantity: 1,
            unit: "kg",
            food_ref_id: riz?.id,
          },
          {
            name: `Oeufs ${tag}`,
            category: "frais",
            quantity: 6,
            unit: "piece",
            food_ref_id: oeuf?.id,
          },
          { name: `Sauce ${tag}`, category: "sauces", food_ref_id: null },
        ],
        idempotency_key: `courses-${tag}`,
      });

      const recipe = {
        title: `Riz sauté ${tag}`,
        servings: 2,
        total_minutes: 20,
        steps: ["Cuire le riz.", "Faire sauter avec les œufs."],
        ingredients: [
          { name: `riz ${tag} parfumé`, quantity: 0.2, unit: "kg" },
          { name: `Oeufs ${tag}`, quantity: 2, unit: "piece" },
          { name: `Sauce ${tag}`, quantity: 3, unit: "cl" },
        ],
        idempotency_key: `recette-${tag}`,
      };
      let recipeId = 0;

      await t.step("suggest_recipes : le stock, rien d'enregistré", async () => {
        const result = await call("suggest_recipes", { max_minutes: 20 });
        assertEquals(result.filters, { max_minutes: 20 });
        assertEquals(
          result.stock.map((l: { name: string; amount: string }) => [l.name, l.amount]),
          [
            [`Oeufs ${tag}`, "6 pièces"],
            [`Riz ${tag}`, "1 kg"],
            [`Sauce ${tag}`, "Plein"],
          ],
        );
        assertEquals(typeof result.hint, "string");
      });

      await t.step("save_recipe : un aliment ambigu, rien n'est enregistré", async () => {
        const result = await call("save_recipe", recipe);
        assertEquals(result.saved, false);
        assertEquals(
          result.ambiguous.map((a: { index: number }) => a.index),
          [0],
        );
        assertEquals(
          (await sql`select count(*)::int as n from public.recipe where user_id = ${user}`)[0]?.n,
          0,
        );
      });

      await t.step("save_recipe : ingrédients liés au stock, rejoué sans doublon", async () => {
        const fixed = {
          ...recipe,
          ingredients: [
            { ...recipe.ingredients[0], food_ref_id: riz?.id },
            ...recipe.ingredients.slice(1),
          ],
        };
        const saved = await call("save_recipe", fixed);
        assertEquals(saved.replayed, false);
        recipeId = saved.recipe.id;
        assertEquals(
          saved.recipe.ingredients.map(
            (i: { name: string; item?: string; quantity: number; unit: string }) => [
              i.item,
              i.quantity,
              i.unit,
            ],
          ),
          [
            [`Riz ${tag}`, 200, "g"],
            [`Oeufs ${tag}`, 2, "piece"],
            [`Sauce ${tag}`, 30, "ml"],
          ],
        );
        const replay = await call("save_recipe", fixed);
        assertEquals([replay.replayed, replay.recipe.id], [true, recipeId]);
        const list = await call("get_recipes", {});
        assertEquals(
          list.recipes.map((r: { id: number }) => r.id),
          [recipeId],
        );
      });

      await t.step(
        "cook_recipe : repas et stock d'un bloc, rejoué sans double décompte",
        async () => {
          const cook = {
            recipe_id: recipeId,
            portions_eaten: 1,
            idempotency_key: `cuisine-${tag}`,
          };
          const cooked = await call("cook_recipe", cook);
          assertEquals(cooked.replayed, false);
          assertEquals(cooked.meal.label, `Riz sauté ${tag}`);
          // Une portion sur deux : 100 g de riz (350) et 1 œuf de 60 g (84).
          assertEquals(cooked.meal.nutrition.energy_kcal, 434);
          assertEquals(
            cooked.stock.decremented.map((d: { used: number; unit: string }) => [d.used, d.unit]),
            [
              [200, "g"],
              [2, "piece"],
            ],
          );
          assertEquals(
            cooked.stock.to_adjust.map((a: { item: string; reason: string }) => [a.item, a.reason]),
            [[`Sauce ${tag}`, "article suivi en niveau"]],
          );
          assertEquals(typeof cooked.stock_hint, "string");
          assertEquals([await quantity(`Riz ${tag}`), await quantity(`Oeufs ${tag}`)], [800, 4]);

          const replay = await call("cook_recipe", cook);
          assertEquals(
            [replay.replayed, replay.meal.id, replay.stock],
            [true, cooked.meal.id, undefined],
          );
          assertEquals([await quantity(`Riz ${tag}`), await quantity(`Oeufs ${tag}`)], [800, 4]);

          const refused = await call("cook_recipe", { ...cook, portions_cooked: 0.5 });
          assertEquals(typeof refused.error, "string");
        },
      );

      await t.step("delete_entry : le repas cuisiné rend son stock", async () => {
        const [meal] = await sql<{ id: number }[]>`
          select id from public.meal where user_id = ${user} and idempotency_key = ${`cuisine-${tag}`}`;
        const deleted = await call("delete_entry", { kind: "meal", id: meal?.id });
        assertEquals(
          deleted.restocked.map((r: { item: string; delta: number }) => [r.item, r.delta]),
          [
            [`Riz ${tag}`, 200],
            [`Oeufs ${tag}`, 2],
          ],
        );
        assertEquals([await quantity(`Riz ${tag}`), await quantity(`Oeufs ${tag}`)], [1000, 6]);
      });

      await t.step("aucun contenu de recette ni de repas dans les logs", () => {
        assertEquals(
          logged.filter((line) => line.includes(tag)),
          [],
        );
      });
    } finally {
      console.log = consoleLog;
      await client.close();
      await sql`delete from auth.users where id = ${user}`;
      await sql`delete from public.food_ref where code like ${`test-${tag}-%`}`;
      await sql.end();
    }
  },
});
