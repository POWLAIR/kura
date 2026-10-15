import { assertEquals, assertRejects } from "@std/assert";
import { asUser, connect, findCaller } from "./db.ts";

// Test d'intégration : base locale (pnpm db:start) ou base de la CI.
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "asUser applique la RLS de l'utilisateur ; findCaller ignore les clés révoquées",
  ignore: !url,
  async fn() {
    const sql = connect(url as string);
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    try {
      await sql`insert into auth.users (id, email)
                values (${a}, ${`${a}@kura.test`}), (${b}, ${`${b}@kura.test`})`;
      for (const user of [a, b]) {
        await asUser(
          sql,
          user,
          (tx) =>
            tx`insert into public.inventory_item (name, category, location, level)
             values ('Riz', 'feculents', 'placard', 'plein')`,
        );
      }

      const seen = await asUser(
        sql,
        a,
        (tx) => tx`select user_id, auth.uid() as uid from public.inventory_item`,
      );
      assertEquals(
        seen.map((r) => [r.user_id, r.uid]),
        [[a, a]],
      );

      const error = await assertRejects(() =>
        asUser(
          sql,
          a,
          (tx) =>
            tx`insert into public.inventory_item (user_id, name, category, location, level)
             values (${b}, 'Sel', 'epices', 'placard', 'plein')`,
        ),
      );
      assertEquals((error as { code?: string }).code, "42501");

      const [{ role }] = await sql`select current_user as role`;
      assertEquals(role === "authenticated", false, "le rôle ne déborde pas de la transaction");

      const hash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join("");
      const [{ id }] = await sql`insert into public.api_key (user_id, label, key_prefix, key_hash)
                                 values (${a}, 'Test', 'kura_AbCdEfG', ${hash}) returning id`;
      assertEquals(await findCaller(sql, hash), { keyId: Number(id), userId: a });
      await sql`update public.api_key set revoked_at = now() where id = ${id}`;
      assertEquals(await findCaller(sql, hash), null);
    } finally {
      await sql`delete from auth.users where id in (${a}, ${b})`;
      await sql.end();
    }
  },
});
