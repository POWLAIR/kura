import { assertEquals, assertRejects } from "@std/assert";
import { parseOrigins } from "../_shared/cors.ts";
import { asUser, connect } from "../_shared/db.ts";
import { AuthUnavailableError, authUserFinder, bearerToken } from "../_shared/session.ts";
import { createHandler, type HandlerDeps } from "./handler.ts";

const BASE = "http://localhost/functions/v1/api";
const APP_ORIGIN = "https://kura.example";

// Jetons de test : « jeton-<id> » appartient à l'utilisateur <id>.
const findUser: HandlerDeps["findUser"] = (token) =>
  Promise.resolve(token.startsWith("jeton-") ? token.slice("jeton-".length) : null);

const noDb: HandlerDeps["asUser"] = () => Promise.reject(new Error("pas de base dans ce test"));

function request(
  operation: string,
  init: Omit<RequestInit, "body"> & { token?: string; body?: unknown } = {},
) {
  const { token, body, headers, ...rest } = init;
  return new Request(`${BASE}/${operation}`, {
    method: "POST",
    body: body === undefined ? null : JSON.stringify(body),
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

// Lignes loggées pendant fn, pour vérifier qu'aucun contenu n'y passe.
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

Deno.test("refus avant toute opération : origine, méthode, opération, session", async () => {
  const handler = createHandler({ findUser, asUser: noDb, appOrigins: [APP_ORIGIN] });
  const logs = await capturingLogs(async () => {
    const foreign = await handler(
      request("get_inventory", {
        token: "jeton-a",
        headers: { origin: "https://ailleurs.example" },
      }),
    );
    assertEquals([foreign.status, await errorOf(foreign)], [403, "origin_refused"]);
    assertEquals(foreign.headers.get("access-control-allow-origin"), null);

    const get = await handler(request("get_inventory", { method: "GET", token: "jeton-a" }));
    assertEquals([get.status, await errorOf(get)], [405, "method_not_allowed"]);

    const unknown = await handler(request("drop_everything", { token: "jeton-a", body: {} }));
    assertEquals([unknown.status, await errorOf(unknown)], [404, "unknown_operation"]);

    const anonymous = await handler(request("get_inventory", { body: {} }));
    assertEquals([anonymous.status, await errorOf(anonymous)], [401, "unauthenticated"]);

    const refused = await handler(request("get_inventory", { token: "inconnu", body: {} }));
    assertEquals([refused.status, await errorOf(refused)], [401, "unauthenticated"]);
  });
  assertEquals(
    logs.map((line) => JSON.parse(line)),
    [
      { event: "auth_refused", reason: "missing_token" },
      { event: "auth_refused", reason: "invalid_token" },
    ],
  );
});

Deno.test("CORS : préflight et réponses pour l'app web et localhost seulement", async () => {
  const handler = createHandler({ findUser, asUser: noDb, appOrigins: [APP_ORIGIN] });
  for (const origin of [APP_ORIGIN, "http://localhost:8081"]) {
    const preflight = await handler(
      request("add_items", { method: "OPTIONS", headers: { origin } }),
    );
    assertEquals(preflight.status, 204);
    assertEquals(preflight.headers.get("access-control-allow-origin"), origin);

    const answer = await handler(request("get_inventory", { headers: { origin }, body: {} }));
    assertEquals(answer.status, 401);
    assertEquals(answer.headers.get("access-control-allow-origin"), origin);
    await answer.body?.cancel();
  }
  assertEquals(parseOrigins(" https://a.example/ ,https://b.example,, "), [
    "https://a.example",
    "https://b.example",
  ]);
  assertEquals(parseOrigins(undefined), []);
});

Deno.test("auth injoignable : 503, jamais 401", async () => {
  const handler = createHandler({
    findUser: () => Promise.reject(new AuthUnavailableError(502)),
    asUser: noDb,
    appOrigins: [],
  });
  const logs = await capturingLogs(async () => {
    const response = await handler(request("get_inventory", { token: "jeton-a", body: {} }));
    assertEquals([response.status, await errorOf(response)], [503, "auth_unavailable"]);
    assertEquals(response.headers.get("retry-after"), "5");
  });
  assertEquals(
    logs.map((line) => JSON.parse(line)),
    [{ event: "auth_unavailable", code: "auth_http_502" }],
  );
});

Deno.test("saisie invalide : 400 avec les chemins, sans les valeurs ; erreur interne : 500", async () => {
  const handler = createHandler({ findUser, asUser: noDb, appOrigins: [] });
  const logs = await capturingLogs(async () => {
    const notJson = await handler(
      new Request(`${BASE}/log_weight`, {
        method: "POST",
        headers: { authorization: "Bearer jeton-a" },
        body: "{",
      }),
    );
    assertEquals([notJson.status, await errorOf(notJson)], [400, "invalid_json"]);

    const invalid = await handler(
      request("log_weight", {
        token: "jeton-a",
        body: { weight_kg: "soixante-douze", idempotency_key: "pesee-secrete-1" },
      }),
    );
    assertEquals(invalid.status, 400);
    const { error } = (await invalid.json()) as {
      error: { code: string; issues: { path: string; message: string }[] };
    };
    assertEquals(error.code, "invalid_input");
    assertEquals(
      error.issues.map((issue) => issue.path),
      ["weight_kg"],
    );

    const broken = await handler(
      request("log_weight", {
        token: "jeton-a",
        body: { weight_kg: 72.4, idempotency_key: "pesee-secrete-2" },
      }),
    );
    assertEquals([broken.status, await errorOf(broken)], [500, "internal"]);
  });
  // Un seul log, sans poids, sans clé et sans message d'erreur.
  assertEquals(
    logs.map((line) => JSON.parse(line)),
    [{ event: "api_error", operation: "log_weight", code: "Error" }],
  );
});

Deno.test("bearerToken et authUserFinder : jeton accepté, refusé, service en panne", async () => {
  assertEquals(bearerToken(new Headers({ authorization: "Bearer abc.def" })), "abc.def");
  assertEquals(bearerToken(new Headers({ authorization: "Basic abc" })), null);
  assertEquals(bearerToken(new Headers()), null);

  const seen: { url: string; authorization: string | null; apikey: string | null }[] = [];
  const answers: Response[] = [
    Response.json({ id: "user-a", email: "a@kura.test" }),
    Response.json({ msg: "invalid JWT" }, { status: 401 }),
    new Response("bad gateway", { status: 502 }),
  ];
  const find = authUserFinder("http://kong:8000", "cle-env", (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
    });
    return Promise.resolve(answers.shift() as Response);
  });

  assertEquals(await find("jeton", "cle-app"), "user-a");
  assertEquals(await find("jeton", null), null);
  await assertRejects(() => find("jeton", null), AuthUnavailableError);
  assertEquals(seen, [
    { url: "http://kong:8000/auth/v1/user", authorization: "Bearer jeton", apikey: "cle-app" },
    { url: "http://kong:8000/auth/v1/user", authorization: "Bearer jeton", apikey: "cle-env" },
    { url: "http://kong:8000/auth/v1/user", authorization: "Bearer jeton", apikey: "cle-env" },
  ]);
});

// Test d'intégration : handler → opérations partagées → base (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "opérations de bout en bout : RLS, rejeu idempotent, saisie refusée",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const [user, other] = [crypto.randomUUID(), crypto.randomUUID()];
    const tag = user.slice(0, 8); // noms uniques : la base locale peut contenir Ciqual
    const handler = createHandler({
      findUser,
      asUser: (userId, fn) => asUser(sql, userId, fn),
      appOrigins: [],
    });
    const call = async (as: string, operation: string, body: unknown = {}) => {
      const response = await handler(request(operation, { token: `jeton-${as}`, body }));
      return { status: response.status, data: await response.json() };
    };
    type Inventory = { items: { id: number; name: string }[] };

    try {
      await sql`insert into auth.users (id, email)
                values (${user}, ${`${user}@kura.test`}), (${other}, ${`${other}@kura.test`})`;

      const purchase = {
        items: [{ name: `Gomasio ${tag}`, category: "epices", food_ref_id: null }],
        idempotency_key: `courses-${tag}`,
      };
      let itemId = 0;

      await t.step("add_items : même réponse que le tool MCP, rejeu sans doublon", async () => {
        const first = await call(user, "add_items", purchase);
        assertEquals(first.status, 200);
        assertEquals(first.data.created.length, 1);
        assertEquals(first.data.replayed, undefined);
        itemId = first.data.created[0].id;

        const again = await call(user, "add_items", purchase);
        assertEquals(again.data.replayed, true);
        assertEquals(again.data.created[0].id, itemId);

        const { data } = await call(user, "get_inventory");
        assertEquals(
          (data as Inventory).items.map((item) => item.name),
          [`Gomasio ${tag}`],
        );
      });

      await t.step("RLS : l'autre utilisateur ne voit ni ne modifie cet article", async () => {
        const { data } = await call(other, "get_inventory");
        assertEquals((data as Inventory).items, []);

        const update = await call(other, "update_item", {
          item_id: itemId,
          changes: { level: "moitie" },
        });
        assertEquals([update.status, update.data.error.code], [422, "refused"]);
      });

      await t.step("update_item puis liste « À racheter »", async () => {
        const update = await call(user, "update_item", {
          item_id: itemId,
          changes: { level: "presque_vide", restock_level: "presque_vide" },
        });
        assertEquals(update.status, 200);
        assertEquals(update.data.updated.low_stock, true);

        const { data } = await call(user, "get_shopping_list");
        assertEquals(
          (data as Inventory).items.map((item) => item.id),
          [itemId],
        );
      });

      await t.step(
        "suivi : pesée enregistrée une fois, visible dans le résumé du jour",
        async () => {
          const weight = { weight_kg: 72.4, idempotency_key: `pesee-${tag}` };
          const first = await call(user, "log_weight", weight);
          assertEquals([first.status, first.data.replayed], [200, false]);
          const again = await call(user, "log_weight", weight);
          assertEquals(again.data.replayed, true);

          const { data } = await call(user, "get_summary", { period: "day" });
          assertEquals(data.weights.length, 1);
          assertEquals((await call(other, "get_summary", { period: "day" })).data.weights, []);
        },
      );
    } finally {
      await sql`delete from auth.users where id in (${user}, ${other})`;
      await sql.end();
    }
  },
});
