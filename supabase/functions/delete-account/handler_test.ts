import { assertEquals } from "@std/assert";
import { asUser, connect } from "../_shared/db.ts";
import { createHandler, type HandlerDeps } from "./handler.ts";

const URL_FUNCTION = "http://localhost/functions/v1/delete-account";

// Jetons de test : « jeton-<id> » appartient à l'utilisateur <id>.
const findUser: HandlerDeps["findUser"] = (token) =>
  Promise.resolve(token.startsWith("jeton-") ? token.slice("jeton-".length) : null);

function post(handler: (request: Request) => Promise<Response>, token: string, body: unknown) {
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

Deno.test("sans session ou sans confirmation : rien n'est supprimé", async () => {
  const deleted: string[] = [];
  const handler = createHandler({
    findUser,
    appOrigins: [],
    deleteUser: (userId) => {
      deleted.push(userId);
      return Promise.resolve();
    },
  });
  await capturingLogs(async () => {
    const anonymous = await post(handler, "inconnu", { confirm: "SUPPRIMER" });
    assertEquals(anonymous.status, 401);
    await anonymous.body?.cancel();

    for (const body of [{}, { confirm: "supprimer" }, { confirm: true }, { user_id: "user-b" }]) {
      const refused = await post(handler, "jeton-user-a", body);
      assertEquals(refused.status, 400);
      await refused.body?.cancel();
    }
  });
  assertEquals(deleted, []);
});

Deno.test("confirmé : seul le compte de la session est supprimé", async () => {
  const deleted: string[] = [];
  const handler = createHandler({
    findUser,
    appOrigins: [],
    deleteUser: (userId) => {
      deleted.push(userId);
      return Promise.resolve();
    },
  });
  // Un autre id glissé dans le corps est ignoré : le schéma ne le lit pas.
  const response = await post(handler, "jeton-user-a", { confirm: "SUPPRIMER", user_id: "user-b" });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { deleted: true });
  assertEquals(deleted, ["user-a"]);
});

Deno.test("suppression en échec : 502, seulement un code dans les logs", async () => {
  const handler = createHandler({
    findUser,
    appOrigins: [],
    deleteUser: () =>
      Promise.reject(Object.assign(new Error("user a@kura.test"), { code: "auth_admin_http_500" })),
  });
  const logs = await capturingLogs(async () => {
    const response = await post(handler, "jeton-user-a", { confirm: "SUPPRIMER" });
    assertEquals(response.status, 502);
    assertEquals(
      ((await response.json()) as { error: { code: string } }).error.code,
      "delete_failed",
    );
  });
  assertEquals(
    logs.map((line) => JSON.parse(line)),
    [{ event: "delete_account_error", code: "auth_admin_http_500" }],
  );
});

// Test d'intégration : la suppression du compte emporte toutes les lignes (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "après suppression, plus aucune ligne avec ce user_id ; l'autre utilisateur garde tout",
  ignore: !url,
  async fn() {
    const sql = connect(url as string);
    const [user, other] = [crypto.randomUUID(), crypto.randomUUID()];
    const tag = user.slice(0, 8);
    // Nombre de lignes par table portant user_id, pour un utilisateur.
    const rowsOf = async (id: string) => {
      const tables = await sql<{ table_name: string }[]>`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id' and table_name in (
          select tablename from pg_tables where schemaname = 'public')
        order by table_name`;
      const counts: Record<string, number> = {};
      for (const { table_name } of tables) {
        const [row] = await sql<{ n: number }[]>`
          select count(*)::int as n from public.${sql(table_name)} where user_id = ${id}`;
        counts[table_name] = row?.n ?? 0;
      }
      return counts;
    };

    try {
      await sql`insert into auth.users (id, email)
                values (${user}, ${`${user}@kura.test`}), (${other}, ${`${other}@kura.test`})`;
      const [food] = await sql<{ id: number }[]>`
        insert into public.food_ref (source, code, name, energy_kcal)
        values ('off', ${`test-${tag}`}, ${`Riz ${tag}`}, 130) returning id`;
      // Une ligne dans chaque table de l'utilisateur, pour les deux comptes.
      for (const id of [user, other]) {
        await asUser(sql, id, async (tx) => {
          const [item] = await tx<{ id: number }[]>`
            select public.add_item(${`Riz ${tag}`}, 'feculents', 'placard', 500, 'g', ${food?.id ?? null}) as id`;
          await tx`select public.log_meal('Riz', ${tx.json([{ name: "riz", food_ref_id: food?.id ?? null, quantity: 100, unit: "g" }])}, ${`repas-${id}`})`;
          await tx`insert into public.workout (started_at, type, duration_min) values (now(), 'vélo', 30)`;
          await tx`insert into public.body_measure (measured_at, weight_kg) values (now(), 70)`;
          await tx`select public.set_food_conversion(${food?.id ?? null}, '{"piece_weight_g": 60}')`;
          await tx`insert into public.companion_event (type) values ('test')`;
          await tx`insert into public.api_key (label, key_prefix, key_hash)
                   values ('Test', 'kura_AbCdEfG', ${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")})`;
          await tx`insert into public.idempotent_call (idempotency_key, tool) values (${`cle-${id}`}, 'add_items')`;
          const [recipe] = await tx<{ id: number }[]>`
            insert into public.recipe (title, origin) values ('Riz nature', 'manuelle') returning id`;
          await tx`insert into public.recipe_ingredient (recipe_id, inventory_item_id, quantity, unit)
                   values (${recipe?.id ?? null}, ${item?.id ?? null}, 100, 'g')`;
        });
      }
      const before = await rowsOf(user);
      const untouched = Object.entries(before)
        .filter(([, n]) => n === 0)
        .map(([table]) => table);
      assertEquals(untouched, [], "chaque table utilisateur a une ligne avant la suppression");

      const handler = createHandler({
        findUser,
        appOrigins: [],
        // Ce que fait Supabase Auth : supprimer la ligne de auth.users.
        deleteUser: async (id) => {
          await sql`delete from auth.users where id = ${id}`;
        },
      });
      const response = await post(handler, `jeton-${user}`, { confirm: "SUPPRIMER" });
      assertEquals(response.status, 200);
      await response.body?.cancel();

      const after = await rowsOf(user);
      assertEquals(
        Object.values(after).every((n) => n === 0),
        true,
        JSON.stringify(after),
      );
      assertEquals(await rowsOf(other), before, "les lignes de l'autre utilisateur sont intactes");
      // Le référentiel partagé reste.
      assertEquals(
        (await sql`select 1 from public.food_ref where id = ${food?.id ?? null}`).length,
        1,
      );
    } finally {
      await sql`delete from auth.users where id in (${user}, ${other})`;
      await sql`delete from public.food_ref where code = ${`test-${tag}`}`;
      await sql.end();
    }
  },
});
