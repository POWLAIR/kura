import { generateApiKey, hashApiKey } from "@kura/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertEquals, assertRejects } from "@std/assert";
import type { Caller } from "./db.ts";
import { createHandler } from "./handler.ts";
import { buildServer, SERVER_INFO } from "./server.ts";

const URL_MCP = new URL("http://localhost/functions/v1/mcp");
const key = generateApiKey();
const keyHash = await hashApiKey(key);
const builtFor: Caller[] = [];

const handler = createHandler({
  findCaller: (hash) => Promise.resolve(hash === keyHash ? { keyId: 7, userId: "user-a" } : null),
  buildServer: (caller) => {
    builtFor.push(caller);
    return buildServer(() => Promise.reject(new Error("pas de base dans ce test")));
  },
});

function post(headers: Record<string, string>): Promise<Response> {
  return handler(
    new Request(URL_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
}

function connect(authorization: string, versionNegotiation: "legacy" | { pin: string }) {
  const client = new Client(
    { name: "test", version: "0" },
    { versionNegotiation: { mode: versionNegotiation } },
  );
  const transport = new StreamableHTTPClientTransport(URL_MCP, {
    fetch: (url, init) => handler(new Request(url, init)),
    requestInit: { headers: { authorization } },
  });
  return { client, connected: client.connect(transport) };
}

for (const [name, headers] of Object.entries<Record<string, string>>({
  "sans en-tête": {},
  "clé mal formée": { authorization: "Bearer kura_trop-court" },
  "clé inconnue ou révoquée": { authorization: `Bearer ${generateApiKey()}` },
  "autre schéma": { authorization: `Basic ${key}` },
})) {
  Deno.test(`401 ${name}`, async () => {
    const res = await post(headers);
    assertEquals(res.status, 401);
    assertEquals(
      res.headers.get("www-authenticate")?.startsWith('Bearer error="invalid_token"'),
      true,
    );
    await res.body?.cancel();
  });
}

for (const header of ["x-api-key", "x-auth-api-key", "x-un-autre-nom"]) {
  Deno.test(`clé dans ${header} (connecteur claude.ai) : acceptée`, async () => {
    const res = await post({ [header]: key });
    assertEquals(res.status, 200);
    await res.body?.cancel();
  });
}

Deno.test("503 sans challenge quand la base ne répond pas : la clé n'est pas mise en cause", async () => {
  const down = createHandler({
    findCaller: () =>
      Promise.reject(Object.assign(new Error("connexion refusée"), { code: "ECONNREFUSED" })),
    buildServer: () => buildServer(() => Promise.reject(new Error("pas de base"))),
  });
  const res = await down(
    new Request(URL_MCP, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: "{}",
    }),
  );
  assertEquals(res.status, 503);
  assertEquals(res.headers.get("www-authenticate"), null);
  await res.body?.cancel();
});

Deno.test("403 depuis une page web d'une autre origine", async () => {
  const res = await post({ authorization: `Bearer ${key}`, origin: "https://exemple.com" });
  assertEquals(res.status, 403);
  await res.body?.cancel();
});

for (const [era, negotiation] of Object.entries({
  "2025 (initialize)": "legacy",
  "2026-07-28": { pin: "2026-07-28" },
} as const)) {
  Deno.test(`client MCP ${era} : connexion et tools/list`, async () => {
    builtFor.length = 0;
    const { client, connected } = connect(`Bearer ${key}`, negotiation);
    await connected;
    assertEquals(client.getServerVersion()?.name, SERVER_INFO.name);
    assertEquals((await client.listTools()).tools.map((t) => t.name).sort(), [
      "add_items",
      "get_inventory",
      "get_shopping_list",
      "get_summary",
      "log_meal",
      "log_weight",
      "log_workout",
      "set_food_conversion",
      "update_item",
    ]);
    assertEquals(builtFor.at(-1), { keyId: 7, userId: "user-a" });
    await client.close();
  });
}

Deno.test("client MCP refusé sans clé valide", async () => {
  const { client, connected } = connect(`Bearer ${generateApiKey()}`, "legacy");
  await assertRejects(() => connected);
  await client.close();
});
