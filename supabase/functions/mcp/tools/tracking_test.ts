import { generateApiKey, hashApiKey } from "@kura/core";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertEquals } from "@std/assert";
import { createApp } from "../app.ts";
import { connect } from "../db.ts";

// Test d'intégration : client MCP officiel → handler → base (pnpm db:start ou CI).
const url = Deno.env.get("KURA_TEST_DB_URL");

Deno.test({
  name: "tools de suivi de bout en bout",
  ignore: !url,
  async fn(t) {
    const sql = connect(url as string);
    const user = crypto.randomUUID();
    const tag = user.slice(0, 8); // noms et clés uniques : la base locale peut contenir Ciqual
    const key = generateApiKey();
    const client = new Client({ name: "test", version: "0" });
    // Tout ce que le serveur logge pendant le test, pour vérifier qu'aucune donnée n'y passe.
    const logged: string[] = [];
    const consoleLog = console.log;
    console.log = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      await sql`insert into auth.users (id, email) values (${user}, ${`${user}@kura.test`})`;
      await sql`insert into public.api_key (user_id, label, key_prefix, key_hash)
                values (${user}, 'Test', ${key.slice(0, 12)}, ${await hashApiKey(key)})`;
      const [, verte, , kiwi, oeuf] = await sql<{ id: number }[]>`
        insert into public.food_ref (source, code, name, energy_kcal, protein_g, sugars_g, piece_weight_g)
        values
          ('off', ${`test-${tag}-1`}, ${`Quinoa ${tag}, cru`}, 360, 14, null, null),
          ('off', ${`test-${tag}-2`}, ${`Lentille ${tag}, verte, crue`}, 330, 24, 1.5, null),
          ('off', ${`test-${tag}-3`}, ${`Lentille ${tag}, corail, crue`}, 340, 25, 2, null),
          ('off', ${`test-${tag}-4`}, ${`Kiwi ${tag}, cru`}, 60, 1, 9, 75),
          ('off', ${`test-${tag}-5`}, ${`Oeuf ${tag}, cru`}, 140, 12.5, 0.5, null)
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
      const count = async (table: string) =>
        (await sql`select count(*)::int as n from ${sql(table)} where user_id = ${user}`)[0]?.n;

      const meal = {
        label: `Bol ${tag}`,
        eaten_at: "2026-10-15T23:30:00+02:00", // 21h30 UTC : compte pour le 15 à Paris
        idempotency_key: `repas-${tag}`,
        items: [
          { name: `Quinoa ${tag}`, quantity: 100, unit: "g" },
          { name: `Lentilles ${tag}`, quantity: 0.1, unit: "kg" },
          { name: `Kiwis ${tag}`, quantity: 2, unit: "piece", food_ref_id: kiwi?.id },
          { name: `Sauce ${tag}`, quantity: 1.5, unit: "cl", food_ref_id: null },
        ],
      };

      await t.step("log_meal : un aliment ambigu, rien n'est enregistré", async () => {
        const result = await call("log_meal", meal);
        assertEquals(result.logged, false);
        assertEquals(
          result.ambiguous.map((a: { name: string }) => a.name),
          [`Lentilles ${tag}`],
        );
        // Les deux lentilles d'abord ; les suivants ne partagent que le tag du test.
        assertEquals(
          result.ambiguous[0].candidates
            .slice(0, 2)
            .map((c: { name: string }) => c.name)
            .sort(),
          [`Lentille ${tag}, corail, crue`, `Lentille ${tag}, verte, crue`],
        );
        assertEquals(await count("meal"), 0);
      });

      let mealId = 0;
      await t.step("log_meal : totaux depuis food_ref, valeurs partielles signalées", async () => {
        meal.items[1] = { ...meal.items[1], food_ref_id: verte?.id } as (typeof meal.items)[number];
        const { replayed, meal: logged } = await call("log_meal", meal);
        assertEquals(replayed, false);
        assertEquals(logged.eaten_at, "2026-10-15 23:30");
        // 100 g de quinoa (360) + 100 g de lentilles (330) + 2 kiwis de 75 g (90) ; sauce non comptée.
        assertEquals(logged.nutrition.energy_kcal, 780);
        assertEquals(logged.nutrition.protein_g, 39.5);
        assertEquals(logged.nutrition.incomplete, ["sugars_g"]); // absent pour le quinoa
        assertEquals(logged.nutrition.partial_values, true); // sauce sans référence
        assertEquals(
          logged.items.map((i: { grams?: number }) => i.grams ?? null),
          [100, 100, 150, null],
        );
        assertEquals(logged.items[0].food, `Quinoa ${tag}, cru`);
        mealId = logged.id;
      });

      await t.step("log_* rejoués : aucun doublon", async () => {
        const replay = await call("log_meal", meal);
        assertEquals([replay.replayed, replay.meal.id], [true, mealId]);
        assertEquals(await count("meal"), 1);

        const workout = {
          type: "vélo",
          duration_min: 40,
          perceived_intensity: 3,
          started_at: "2026-10-15T18:00:00+02:00",
          idempotency_key: `velo-${tag}`,
        };
        assertEquals((await call("log_workout", workout)).replayed, false);
        assertEquals((await call("log_workout", workout)).replayed, true);
        assertEquals(await count("workout"), 1);

        const weight = {
          weight_kg: 70.456,
          measured_at: "2026-10-15T08:00:00+02:00",
          idempotency_key: `pesee-${tag}-1`,
        };
        const first = await call("log_weight", weight);
        assertEquals([first.replayed, first.weight.weight_kg], [false, 70.46]);
        assertEquals((await call("log_weight", weight)).replayed, true);
        await call("log_weight", {
          weight_kg: 71,
          measured_at: "2026-10-16T08:00:00+02:00",
          idempotency_key: `pesee-${tag}-2`,
        });
        assertEquals(await count("body_measure"), 2);
      });

      await t.step("get_summary : journées à l'heure de Paris", async () => {
        const day = await call("get_summary", { period: "day", date: "2026-10-15" });
        assertEquals(
          day.meals.map((m: { id: number; time: string }) => [m.id, m.time]),
          [[mealId, "23:30"]],
        );
        assertEquals(day.nutrition.energy_kcal, 780);
        assertEquals(day.workout_minutes, 40);
        assertEquals(
          day.weights.map((w: { id: number; time: string; weight_kg: number }) => [
            typeof w.id,
            w.time,
            w.weight_kg,
          ]),
          [["number", "08:00", 70.46]],
        );

        const next = await call("get_summary", { period: "day", date: "2026-10-16" });
        assertEquals([next.meals, next.nutrition.energy_kcal], [[], undefined]);
      });

      await t.step("get_summary : semaine du lundi au dimanche, poids en moyenne", async () => {
        const week = await call("get_summary", { period: "week", date: "2026-10-15" });
        assertEquals([week.from, week.to], ["2026-10-12", "2026-10-18"]);
        assertEquals(week.days.length, 7);
        assertEquals(week.days[3], {
          date: "2026-10-15",
          meals: 1,
          nutrition: week.nutrition,
          workout_minutes: 40,
        });
        assertEquals(week.weight, { average_kg: 70.7, measures: 2 });
      });

      await t.step(
        "set_food_conversion : poids donné par l'utilisateur, repas recalculés",
        async () => {
          const eggs = {
            label: `Oeufs ${tag}`,
            eaten_at: "2026-10-17T12:00:00+02:00",
            idempotency_key: `oeufs-${tag}`,
            items: [{ name: `Oeufs ${tag}`, quantity: 2, unit: "piece", food_ref_id: oeuf?.id }],
          };
          const first = await call("log_meal", eggs);
          assertEquals(first.meal.nutrition.partial_values, true);
          assertEquals(first.missing_conversions, [
            {
              food_ref_id: oeuf?.id,
              name: `Oeufs ${tag}`,
              food: `Oeuf ${tag}, cru`,
              unit: "piece",
              field: "piece_weight_g",
            },
          ]);

          const refused = await call("set_food_conversion", { food_ref_id: oeuf?.id });
          assertEquals(typeof refused.error, "string"); // aucune valeur donnée

          const set = await call("set_food_conversion", {
            food_ref_id: oeuf?.id,
            piece_weight_g: 60,
          });
          assertEquals(set, {
            food: { id: oeuf?.id, name: `Oeuf ${tag}, cru` },
            piece_weight_g: 60,
            density_g_ml: null,
            meals_updated: 1,
          });

          // 2 œufs de 60 g à 140 kcal pour 100 g.
          const day = await call("get_summary", { period: "day", date: "2026-10-17" });
          assertEquals([day.nutrition.energy_kcal, day.nutrition.partial_values], [168, false]);
          const replay = await call("log_meal", eggs);
          assertEquals([replay.meal.items[0].grams, replay.missing_conversions], [120, undefined]);
        },
      );

      await t.step("corrections : séance et pesée corrigées, entrées supprimées", async () => {
        const day = await call("get_summary", { period: "day", date: "2026-10-15" });
        const [weight] = day.weights;
        const [workout] = day.workouts;

        const fixedWeight = await call("update_weight", {
          id: weight.id,
          changes: { weight_kg: 70.6 },
        });
        assertEquals(fixedWeight.weight, {
          id: weight.id,
          weight_kg: 70.6,
          measured_at: "2026-10-15 08:00",
        });

        const fixedWorkout = await call("update_workout", {
          id: workout.id,
          changes: { duration_min: 45, perceived_intensity: null },
        });
        assertEquals(fixedWorkout.workout, {
          id: workout.id,
          type: "vélo",
          duration_min: 45,
          started_at: "2026-10-15 18:00",
        });
        const refused = await call("update_workout", { id: workout.id, changes: {} });
        assertEquals(typeof refused.error, "string");

        const deleted = await call("delete_entry", { kind: "meal", id: mealId });
        assertEquals(deleted.deleted, {
          kind: "meal",
          id: mealId,
          label: `Bol ${tag}`,
          at: "2026-10-15 23:30",
        });
        const [items] = await sql`
          select count(*)::int as n from public.meal_item where meal_id = ${mealId}`;
        assertEquals([await count("meal"), items?.n], [1, 0]); // reste le repas d'œufs
        const again = await call("delete_entry", { kind: "meal", id: mealId });
        assertEquals(again.error, `Repas ${mealId} introuvable (déjà supprimé ?)`);

        const after = await call("get_summary", { period: "day", date: "2026-10-15" });
        assertEquals(
          [after.meals, after.workout_minutes, after.weights[0].weight_kg],
          [[], 45, 70.6],
        );

        await call("delete_entry", { kind: "workout", id: workout.id });
        await call("delete_entry", { kind: "weight", id: weight.id });
        assertEquals([await count("workout"), await count("body_measure")], [0, 1]);
      });

      await t.step("aucune donnée de repas ou de poids dans les logs", () => {
        assertEquals(
          logged.filter(
            (line) => line.includes(tag) || line.includes("70.4") || line.includes("70.6"),
          ),
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
