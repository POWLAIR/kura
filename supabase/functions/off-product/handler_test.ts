import { offProductUrl } from "@kura/core";
import { assertEquals } from "@std/assert";
import { connect, type Sql } from "../_shared/db.ts";
import { createHandler, type HandlerDeps } from "./handler.ts";

const URL_FUNCTION = "http://localhost/functions/v1/off-product";
const USER_AGENT = "Kura/test (test)";

const findUser: HandlerDeps["findUser"] = (token) =>
  Promise.resolve(token === "jeton-a" ? "user-a" : null);

// EAN-13 aléatoire, clé de contrôle juste : ne heurte aucun vrai produit de la base locale.
function randomEan(): string {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x % 10);
  const sum = digits.reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 1 : 3), 0);
  return `${digits.join("")}${(10 - (sum % 10)) % 10}`;
}

type Call = { url: string; headers: Record<string, string> };

// Faux Open Food Facts : note chaque requête reçue et répond avec `answer`.
function fakeOff(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchOff: typeof fetch = (input, init) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return Promise.resolve(answer());
  };
  return { calls, fetchOff };
}

function post(handler: (request: Request) => Promise<Response>, body: unknown, token = "jeton-a") {
  return handler(
    new Request(URL_FUNCTION, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
}

async function capturingLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

const noDb = (() => {
  throw new Error("pas de base dans ce test");
}) as unknown as Sql;

Deno.test("sans session ou avec un code invalide : rien ne part vers Open Food Facts", async () => {
  const off = fakeOff(() => Response.json({ status: 0 }));
  const handler = createHandler({
    findUser,
    appOrigins: [],
    sql: noDb,
    fetchOff: off.fetchOff,
    userAgent: USER_AGENT,
  });
  await capturingLogs(async () => {
    const anonymous = await post(handler, { ean: randomEan() }, "inconnu");
    assertEquals(anonymous.status, 401);
    await anonymous.body?.cancel();

    for (const ean of ["3017620422004", "abc", "", 3017620422003]) {
      const invalid = await post(handler, { ean });
      assertEquals(invalid.status, 400);
      assertEquals(
        ((await invalid.json()) as { error: { code: string } }).error.code,
        "invalid_input",
      );
    }
  });
  assertEquals(off.calls, []);
});

// Test d'intégration : handler → faux Open Food Facts → base (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "produit par code-barres : cache, inconnu, Open Food Facts en panne",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const [known, unknown, down] = [randomEan(), randomEan(), randomEan()];
    const product = {
      status: 1,
      product: {
        product_name_fr: "Sauce soja salée",
        brands: "Kikko",
        product_quantity: 150,
        product_quantity_unit: "ml",
        nutriments_estimated: { calcium_100g: 0.02 },
        nutriments: {
          "energy-kcal_100g": 77,
          proteins_100g: 10,
          salt_100g: 16.9,
          iron_100g: 0.002,
        },
      },
    };
    const handlerWith = (off: ReturnType<typeof fakeOff>) =>
      createHandler({
        findUser,
        appOrigins: [],
        sql,
        fetchOff: off.fetchOff,
        userAgent: USER_AGENT,
      });
    const rows = (ean: string) =>
      sql`select id from public.food_ref where source = 'off' and code = ${ean}`;

    try {
      const logs = await capturingLogs(async () => {
        let id = 0;
        await t.step(
          "premier scan : une requête, le seul code-barres, produit mis en cache",
          async () => {
            const off = fakeOff(() => Response.json(product));
            const response = await post(handlerWith(off), { ean: known });
            assertEquals(response.status, 200);
            const { found, cached, food } = await response.json();
            assertEquals([found, cached], [true, false]);
            assertEquals(
              {
                code: food.code,
                name: food.name,
                brand: food.brand,
                package: [food.package_quantity, food.package_unit],
                per: food.per_100_unit,
                energy_kcal: food.energy_kcal,
                salt_g: food.salt_g,
                sugars_g: food.sugars_g,
                micronutrients: food.micronutrients,
              },
              {
                code: known,
                name: "Sauce soja salée",
                brand: "Kikko",
                package: [150, "ml"],
                per: "ml",
                energy_kcal: 77,
                salt_g: 16.9,
                sugars_g: null, // non renseigné : jamais estimé
                micronutrients: { iron_mg: 2 }, // pas le calcium, estimé par OFF
              },
            );
            id = food.id;
            // Ni jeton ni identifiant : seulement le code-barres et le User-Agent.
            assertEquals(off.calls, [
              {
                url: offProductUrl(known),
                headers: { accept: "application/json", "user-agent": USER_AGENT },
              },
            ]);
          },
        );

        await t.step("second scan : servi par le cache, aucune requête", async () => {
          const off = fakeOff(() => Response.json({ status: 0 }));
          const response = await post(handlerWith(off), { ean: known });
          const { found, cached, food } = await response.json();
          assertEquals([found, cached, food.id], [true, true, id]);
          assertEquals(off.calls, []);
          assertEquals((await rows(known)).length, 1);
        });

        await t.step(
          "code inconnu d'Open Food Facts : réponse explicite, rien en cache",
          async () => {
            for (const answer of [
              () =>
                Response.json({ code: unknown, status: 0, status_verbose: "product not found" }),
              () => new Response("not found", { status: 404 }),
            ]) {
              const response = await post(handlerWith(fakeOff(answer)), { ean: unknown });
              assertEquals(response.status, 200);
              assertEquals(await response.json(), { found: false, ean: unknown });
            }
            assertEquals((await rows(unknown)).length, 0);
          },
        );

        await t.step("Open Food Facts en panne : 502, rien en cache", async () => {
          for (const answer of [
            () => new Response("oops", { status: 503 }),
            () => Promise.reject(new DOMException("délai dépassé", "TimeoutError")),
          ]) {
            const response = await post(handlerWith(fakeOff(answer)), { ean: down });
            assertEquals(response.status, 502);
            const { error } = (await response.json()) as { error: { code: string } };
            assertEquals(error.code, "off_unavailable");
          }
          assertEquals((await rows(down)).length, 0);
        });
      });

      await t.step("logs : des codes seulement, ni code-barres ni nom de produit", () => {
        assertEquals(
          logs.map((line) => JSON.parse(line)),
          [
            { event: "off_unavailable", code: "off_http_503" },
            { event: "off_unavailable", code: "TimeoutError" },
          ],
        );
      });
    } finally {
      await sql`delete from public.food_ref where source = 'off' and code in (${known}, ${unknown}, ${down})`;
      await sql.end();
    }
  },
});
