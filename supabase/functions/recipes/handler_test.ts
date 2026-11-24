import type { GeneratedRecipes } from "@kura/core";
import { assertEquals } from "@std/assert";
import { asUser, connect } from "../_shared/db.ts";
import { GenerationError } from "./generate.ts";
import { createHandler, type HandlerDeps } from "./handler.ts";

const URL_FUNCTION = "http://localhost/functions/v1/recipes";

function post(handler: (request: Request) => Promise<Response>, body: unknown, token = "jeton-a") {
  return handler(
    new Request(URL_FUNCTION, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
}

const neverGenerate: HandlerDeps["generate"] = () => {
  throw new Error("le modèle ne doit pas être appelé");
};

Deno.test("refus avant tout appel : session absente, saisie invalide", async () => {
  const handler = createHandler({
    findUser: (token) => Promise.resolve(token === "jeton-a" ? "user-a" : null),
    asUser: () => Promise.reject(new Error("pas de base")),
    appOrigins: [],
    generate: neverGenerate,
  });
  assertEquals((await post(handler, {}, "autre")).status, 401);
  const invalid = await post(handler, { servings: 0 });
  assertEquals(invalid.status, 400);
  await invalid.body?.cancel();
});

const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "recettes générées, enregistrées et classées",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const user = crypto.randomUUID();
    const tag = user.slice(0, 8);
    const prompts: string[] = [];
    let answer: () => Promise<GeneratedRecipes> = () => Promise.resolve({ recipes: [] });
    const logged: string[] = [];
    const consoleLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(" "));
    const handler = createHandler({
      findUser: (token) => Promise.resolve(token === "jeton-a" ? user : null),
      asUser: (userId, fn) => asUser(sql, userId, fn),
      appOrigins: [],
      today: () => "2026-11-18",
      generate: (prompt) => {
        prompts.push(prompt);
        return answer();
      },
    });
    try {
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@kura.test`})`;
      const [riz] = await sql<{ id: number }[]>`
        insert into public.food_ref (source, code, name, energy_kcal)
        values ('off', ${`test-${tag}-1`}, ${`Riz ${tag}, cru`}, 350) returning id`;

      await t.step("stock vide : rien à proposer, le modèle n'est pas appelé", async () => {
        const response = await post(handler, {});
        assertEquals(await response.json(), {
          recipes: [],
          notice: "Le stock est vide : rien à proposer.",
        });
        assertEquals(prompts, []);
      });

      const items = await sql<{ id: number }[]>`
        insert into public.inventory_item (user_id, name, food_ref_id, category, location, quantity, unit, expires_on)
        values
          (${user}, ${`Riz ${tag}`}, ${riz?.id ?? null}, 'feculents', 'placard', 1000, 'g', null),
          (${user}, ${`Yaourt ${tag}`}, null, 'frais', 'frigo', 2, 'piece', '2026-11-19')
        returning id`;
      const [rizItem, yaourtItem] = items;

      await t.step("seuls la demande et le stock partent vers le modèle", async () => {
        answer = () => Promise.reject(new GenerationError("model_refusal"));
        const response = await post(handler, { max_minutes: 20, craving: "réconfortant" });
        assertEquals(response.status, 502);
        await response.body?.cancel();
        assertEquals(JSON.parse(prompts.at(-1) ?? "null"), {
          demande: { max_minutes: 20, craving: "réconfortant" },
          stock: [
            {
              item_id: yaourtItem?.id,
              name: `Yaourt ${tag}`,
              amount: "2 pièces",
              expires_on: "2026-11-19",
              expires_soon: true,
            },
            { item_id: rizItem?.id, name: `Riz ${tag}`, amount: "1 kg" },
          ],
        });
        assertEquals(prompts.at(-1)?.includes(user), false);
      });

      await t.step(
        "trois recettes enregistrées, celles qui utilisent ce qui périme d'abord",
        async () => {
          answer = () =>
            Promise.resolve({
              recipes: [
                {
                  title: `Riz nature ${tag}`,
                  servings: 2,
                  total_minutes: 15,
                  steps: ["Cuire le riz."],
                  ingredients: [
                    { name: "riz", quantity: 200, unit: "g", item_id: rizItem?.id ?? null },
                    { name: "sel", quantity: null, unit: null, item_id: null },
                  ],
                },
                {
                  title: `Riz au yaourt ${tag}`,
                  servings: 2,
                  total_minutes: 20,
                  steps: ["Cuire le riz.", "Ajouter le yaourt."],
                  ingredients: [
                    { name: "riz", quantity: 100, unit: "g", item_id: rizItem?.id ?? null },
                    { name: "yaourt", quantity: 1, unit: "piece", item_id: yaourtItem?.id ?? null },
                  ],
                },
                { title: "Vide", servings: 1, total_minutes: 5, steps: [], ingredients: [] },
              ],
            });
          const response = await post(handler, {});
          assertEquals(response.status, 200);
          const { recipes } = await response.json();
          assertEquals(
            recipes.map((r: { title: string; uses_expiring: string[] }) => [
              r.title,
              r.uses_expiring,
            ]),
            [
              [`Riz au yaourt ${tag}`, [`Yaourt ${tag}`]],
              [`Riz nature ${tag}`, []],
            ],
          );
          // Une portion : 100 g de riz à 350 kcal ; le sel non compté rend les valeurs partielles.
          assertEquals(recipes[1].nutrition_per_portion.energy_kcal, 350);
          assertEquals(recipes[1].nutrition_per_portion.partial_values, true);
          assertEquals(recipes[1].origin, "generee");
          const [count] = await sql`
          select count(*)::int as n from public.recipe where user_id = ${user} and origin = 'generee'`;
          assertEquals(count?.n, 2);
        },
      );

      await t.step("aucun contenu dans les logs", () => {
        assertEquals(
          logged.filter((line) => line.includes(tag) || line.includes("réconfortant")),
          [],
        );
        assertEquals(
          logged.some((line) => line.includes('"code":"model_refusal"')),
          true,
        );
      });
    } finally {
      console.log = consoleLog;
      await sql`delete from auth.users where id = ${user}`;
      await sql`delete from public.food_ref where code like ${`test-${tag}-%`}`;
      await sql.end();
    }
  },
});
