import {
  createFoodMatcher,
  DeleteEntryInput,
  daysBetween,
  type EntryKind,
  type Food,
  FoodConversionInput,
  LogMealInput,
  LogWeightInput,
  LogWorkoutInput,
  localDate,
  type MealItemAmbiguity,
  type MealNutrition,
  missingConversions,
  NutritionTotals,
  periodRange,
  resolveMealItems,
  type StoredMealItem,
  SummaryInput,
  sumNutrition,
  TIMEZONE,
  UpdateWeightInput,
  UpdateWorkoutInput,
} from "@kura/core";
import type { McpServer } from "@modelcontextprotocol/server";
import type postgres from "postgres";
import type { Tx } from "../db.ts";
import type { UserDb } from "../server.ts";
import { compact, InputError, ok, userErrors } from "./result.ts";

// Tools de suivi (issue #8) : log_meal, log_workout, log_weight, get_summary ;
// set_food_conversion (issue #20) ; delete_entry, update_workout, update_weight (issue #22).
// Totaux nutritionnels calculés en SQL depuis food_ref (public.log_meal), jamais par Claude.
// Chaque log_* exige une clé d'idempotence : rejoué, il renvoie l'enregistrement existant.
// Les journées sont découpées à l'heure de Paris (TIMEZONE).

const MEAL_HINTS: Record<MealItemAmbiguity["reason"], string> = {
  food: "Choisir food_ref_id parmi candidates, ou food_ref_id null si aucun ne correspond.",
  unknown_food:
    "food_ref_id inconnu : relancer cet aliment sans food_ref_id pour obtenir des candidats.",
};

const CONVERSION_HINT =
  "Valeurs partielles : demander à l'utilisateur le poids d'une pièce (pesée, emballage) ou la densité de ces aliments, sans jamais les estimer, puis appeler set_food_conversion. Ce repas et les précédents seront recalculés.";

const NEUTRAL =
  "Présenter les chiffres tels quels : aucun commentaire sur le poids, les quantités mangées ou les calories, aucun objectif.";

// Repas tel que stocké : totaux de la base, ou vides si le format est inattendu (le repas
// est alors traité comme partiel plutôt que d'afficher des valeurs douteuses).
function nutritionOf(row: { nutrition_totals: unknown; partial_values: boolean }): MealNutrition {
  const totals = NutritionTotals.safeParse(row.nutrition_totals);
  return totals.success
    ? { totals: totals.data, partial_values: row.partial_values }
    : { totals: { values: {}, incomplete: [] }, partial_values: true };
}

type MealRow = {
  id: number;
  label: string;
  day: string;
  time: string;
  partial_values: boolean;
  nutrition_totals: unknown;
};

async function mealView(tx: Tx, mealId: number) {
  const [meal] = await tx<(MealRow & { items: Record<string, unknown>[] })[]>`
    select
      m.id, m.label, m.partial_values, m.nutrition_totals,
      to_char(m.eaten_at at time zone ${TIMEZONE}, 'YYYY-MM-DD') as day,
      to_char(m.eaten_at at time zone ${TIMEZONE}, 'HH24:MI') as time,
      coalesce(json_agg(json_build_object(
        'name', coalesce(mi.name, f.name), 'food', f.name, 'food_ref_id', mi.food_ref_id,
        'quantity', mi.quantity, 'unit', mi.unit, 'grams', mi.quantity_g
      ) order by mi.id) filter (where mi.id is not null), '[]') as items
    from public.meal m
    left join public.meal_item mi on mi.meal_id = m.id
    left join public.food_ref f on f.id = mi.food_ref_id
    where m.id = ${mealId}
    group by m.id`;
  if (!meal) throw new Error("Repas introuvable");
  return {
    id: meal.id,
    label: meal.label,
    eaten_at: `${meal.day} ${meal.time}`,
    nutrition: sumNutrition([nutritionOf(meal)]),
    items: meal.items.map(compact) as StoredMealItem[],
  };
}

// Repas enregistré, avec les aliments à convertir quand il en reste.
async function loggedMeal(tx: Tx, mealId: number, replayed: boolean) {
  const meal = await mealView(tx, mealId);
  const missing = missingConversions(meal.items);
  return missing.length > 0
    ? { replayed, meal, missing_conversions: missing, hint: CONVERSION_HINT }
    : { replayed, meal };
}

async function logMeal(tx: Tx, input: LogMealInput) {
  // Rejoué : le repas existe, inutile de rapprocher à nouveau les aliments.
  const [existing] = await tx<{ id: number }[]>`
    select id from public.meal where idempotency_key = ${input.idempotency_key}`;
  if (existing) return loggedMeal(tx, existing.id, true);

  const foods = await tx<Food[]>`select id, code, name from public.food_ref`;
  const { items, ambiguous } = resolveMealItems(input.items, {
    foodsById: new Map(foods.map((f) => [f.id, f])),
    matchFood: createFoodMatcher(foods, { maxCandidates: 5 }),
  });
  if (ambiguous.length > 0) {
    return {
      logged: false,
      hint: "Rien n'est enregistré : relancer tout le repas avec la précision demandée pour ces aliments.",
      ambiguous: ambiguous.map((a) => ({
        name: a.name,
        reason: a.reason,
        hint: MEAL_HINTS[a.reason],
        candidates: a.candidates.map((f) => ({ food_ref_id: f.id, name: f.name })),
      })),
    };
  }

  const [row] = await tx<{ meal_id: number; replayed: boolean }[]>`
    select * from public.log_meal(
      ${input.label}, ${tx.json(items as unknown as postgres.JSONValue)},
      ${input.idempotency_key}, ${input.eaten_at ?? null}::timestamptz)`;
  if (!row) throw new Error("log_meal sans résultat");
  return loggedMeal(tx, row.meal_id, row.replayed);
}

async function setFoodConversion(tx: Tx, input: FoodConversionInput) {
  const { food_ref_id, ...changes } = input;
  const [row] = await tx<
    { piece_weight_g: number | null; density_g_ml: number | null; meals_updated: number }[]
  >`select * from public.set_food_conversion(${food_ref_id}, ${tx.json(changes)})`;
  if (!row) throw new Error("set_food_conversion sans résultat");
  const [food] = await tx<{ name: string }[]>`
    select name from public.food_ref where id = ${food_ref_id}`;
  return { food: { id: food_ref_id, name: food?.name }, ...row };
}

// Séance ou pesée telle que stockée, par id ou par clé d'idempotence.
type EntryRef = { id: number } | { idempotency_key: string };

function whereRef(tx: Tx, ref: EntryRef) {
  return "id" in ref ? tx`id = ${ref.id}` : tx`idempotency_key = ${ref.idempotency_key}`;
}

async function workoutView(tx: Tx, ref: EntryRef) {
  const [workout] = await tx`
    select id, type, duration_min, perceived_intensity, notes,
      to_char(started_at at time zone ${TIMEZONE}, 'YYYY-MM-DD HH24:MI') as started_at
    from public.workout where ${whereRef(tx, ref)}`;
  return compact(workout ?? {});
}

async function weightView(tx: Tx, ref: EntryRef) {
  const [measure] = await tx`
    select id, weight_kg,
      to_char(measured_at at time zone ${TIMEZONE}, 'YYYY-MM-DD HH24:MI') as measured_at
    from public.body_measure where ${whereRef(tx, ref)}`;
  return measure;
}

async function logWorkout(tx: Tx, input: LogWorkoutInput) {
  const [created] = await tx<{ id: number }[]>`
    insert into public.workout (started_at, type, duration_min, perceived_intensity, notes, idempotency_key)
    values (
      coalesce(${input.started_at ?? null}::timestamptz, now()), ${input.type},
      ${input.duration_min}, ${input.perceived_intensity ?? null}, ${input.notes ?? null},
      ${input.idempotency_key}
    )
    on conflict (user_id, idempotency_key) do nothing
    returning id`;
  const workout = await workoutView(tx, { idempotency_key: input.idempotency_key });
  return { replayed: !created, workout };
}

async function logWeight(tx: Tx, input: LogWeightInput) {
  const [created] = await tx<{ id: number }[]>`
    insert into public.body_measure (measured_at, weight_kg, idempotency_key)
    values (
      coalesce(${input.measured_at ?? null}::timestamptz, now()), ${input.weight_kg},
      ${input.idempotency_key}
    )
    on conflict (user_id, idempotency_key) do nothing
    returning id`;
  const weight = await weightView(tx, { idempotency_key: input.idempotency_key });
  return { replayed: !created, weight };
}

// ---------------------------------------------------------------------------
// Corrections (issue #22)
// ---------------------------------------------------------------------------

const ENTRY_LABEL: Record<EntryKind, string> = {
  meal: "Repas",
  workout: "Séance",
  weight: "Pesée",
};

function notFound(kind: EntryKind, id: number): InputError {
  return new InputError(`${ENTRY_LABEL[kind]} ${id} introuvable (déjà supprimé ?)`);
}

// Un repas emporte ses aliments (on delete cascade) ; le stock n'est pas touché.
async function deleteEntry(tx: Tx, { kind, id }: DeleteEntryInput) {
  const at = (column: string) =>
    tx`to_char(${tx(column)} at time zone ${TIMEZONE}, 'YYYY-MM-DD HH24:MI')`;
  const [deleted] =
    kind === "meal"
      ? await tx`
          delete from public.meal where id = ${id}
          returning id, label, ${at("eaten_at")} as at`
      : kind === "workout"
        ? await tx`
            delete from public.workout where id = ${id}
            returning id, type as label, ${at("started_at")} as at`
        : await tx`
            delete from public.body_measure where id = ${id}
            returning id, ${at("measured_at")} as at`;
  if (!deleted) throw notFound(kind, id);
  return { deleted: { kind, ...deleted } };
}

// Champs validés par le schéma strict : leurs noms sont ceux des colonnes.
async function updateWorkout(tx: Tx, { id, changes }: UpdateWorkoutInput) {
  const [updated] = await tx`
    update public.workout set ${tx(changes)} where id = ${id} returning id`;
  if (!updated) throw notFound("workout", id);
  return { workout: await workoutView(tx, { id }) };
}

async function updateWeight(tx: Tx, { id, changes }: UpdateWeightInput) {
  const [updated] = await tx`
    update public.body_measure set ${tx(changes)} where id = ${id} returning id`;
  if (!updated) throw notFound("weight", id);
  return { weight: await weightView(tx, { id }) };
}

async function summary(tx: Tx, input: SummaryInput) {
  const date = input.date ?? localDate(new Date());
  const { from, to } = periodRange(input.period, date);
  // Bornes : minuit à Paris, du premier jour au lendemain du dernier.
  const start = tx`(${from}::date)::timestamp at time zone ${TIMEZONE}`;
  const end = tx`(${to}::date + 1)::timestamp at time zone ${TIMEZONE}`;
  const local = (column: string, format: string) =>
    tx`to_char(${tx(column)} at time zone ${TIMEZONE}, ${format})`;

  const meals = await tx<MealRow[]>`
    select id, label, partial_values, nutrition_totals,
      ${local("eaten_at", "YYYY-MM-DD")} as day, ${local("eaten_at", "HH24:MI")} as time
    from public.meal where eaten_at >= ${start} and eaten_at < ${end}
    order by eaten_at`;
  const workouts = await tx<
    { id: number; day: string; time: string; type: string; duration_min: number }[]
  >`
    select id, type, duration_min, perceived_intensity,
      ${local("started_at", "YYYY-MM-DD")} as day, ${local("started_at", "HH24:MI")} as time
    from public.workout where started_at >= ${start} and started_at < ${end}
    order by started_at`;
  const weights = await tx<{ id: number; day: string; time: string; weight_kg: number }[]>`
    select id, weight_kg,
      ${local("measured_at", "YYYY-MM-DD")} as day, ${local("measured_at", "HH24:MI")} as time
    from public.body_measure where measured_at >= ${start} and measured_at < ${end}
    order by measured_at`;

  const minutes = (list: { duration_min: number }[]) =>
    list.reduce((sum, w) => sum + w.duration_min, 0);
  const base = {
    period: input.period,
    from,
    to,
    timezone: TIMEZONE,
    nutrition: sumNutrition(meals.map(nutritionOf)),
    workout_minutes: minutes(workouts),
  };

  if (input.period === "day") {
    return {
      ...base,
      meals: meals.map((m) => ({
        id: m.id,
        time: m.time,
        label: m.label,
        partial_values: m.partial_values,
      })),
      workouts: workouts.map(({ day: _day, ...w }) => compact(w)),
      weights: weights.map((w) => ({ id: w.id, time: w.time, weight_kg: w.weight_kg })),
    };
  }

  // Semaine : un résumé par jour ; le poids en moyenne plutôt qu'au jour le jour.
  const average = weights.length
    ? Math.round((weights.reduce((sum, w) => sum + w.weight_kg, 0) / weights.length) * 10) / 10
    : undefined;
  return {
    ...base,
    days: daysBetween(from, to).map((day) => {
      const ofDay = meals.filter((m) => m.day === day);
      return {
        date: day,
        meals: ofDay.length,
        nutrition: sumNutrition(ofDay.map(nutritionOf)),
        workout_minutes: minutes(workouts.filter((w) => w.day === day)),
      };
    }),
    workouts: workouts.map((w) => compact(w)),
    weight: average === undefined ? undefined : { average_kg: average, measures: weights.length },
  };
}

export function registerTrackingTools(server: McpServer, db: UserDb): void {
  server.registerTool(
    "log_meal",
    {
      title: "Enregistrer un repas",
      description:
        "Enregistre un repas hors recette : un libellé et la liste des aliments avec la quantité dans l'unité dite (g, kg, ml, cl, l, piece), sans convertir soi-même en grammes ni estimer de valeurs nutritionnelles. Le serveur rapproche chaque aliment de Ciqual et calcule les totaux ; si un aliment est ambigu, rien n'est enregistré et les candidats sont renvoyés. Une pièce sans poids ou un volume sans densité rendent le repas « valeurs partielles » : missing_conversions liste les valeurs à demander à l'utilisateur (voir set_food_conversion). idempotency_key unique par repas.",
      inputSchema: LogMealInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => logMeal(tx, input)))),
  );

  server.registerTool(
    "set_food_conversion",
    {
      title: "Poids d'une pièce ou densité d'un aliment",
      description:
        "Enregistre le poids d'une pièce (g) ou la densité (g/ml) d'un aliment, tels que l'utilisateur les a donnés : pesée, emballage. Ne jamais les estimer ni les proposer soi-même ; les demander quand log_meal renvoie missing_conversions. La valeur sert aux prochains repas et recalcule les repas déjà saisis avec cet aliment en pièces ou en ml (meals_updated). Un champ absent est gardé, null le retire.",
      inputSchema: FoodConversionInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => setFoodConversion(tx, input)))),
  );

  server.registerTool(
    "log_workout",
    {
      title: "Enregistrer une séance",
      description:
        "Enregistre une séance de sport : type, durée en minutes, intensité ressentie de 1 à 5, date-heure. idempotency_key unique par séance.",
      inputSchema: LogWorkoutInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => logWorkout(tx, input)))),
  );

  server.registerTool(
    "log_weight",
    {
      title: "Enregistrer une pesée",
      description: `Enregistre une pesée en kg. idempotency_key unique par pesée. ${NEUTRAL}`,
      inputSchema: LogWeightInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => logWeight(tx, input)))),
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Supprimer un repas, une séance ou une pesée",
      description:
        "Supprime un repas (avec ses aliments), une séance ou une pesée, par son id (get_summary d'un jour). Toujours confirmer avec l'utilisateur avant d'appeler. Pour corriger un repas : le supprimer puis le ressaisir avec log_meal et une nouvelle idempotency_key. Le stock n'est pas modifié : le corriger avec update_item si besoin. La clé d'idempotence de l'entrée supprimée est libérée : ne jamais rejouer l'ancien appel log_*.",
      inputSchema: DeleteEntryInput,
      annotations: { destructiveHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => deleteEntry(tx, input)))),
  );

  server.registerTool(
    "update_workout",
    {
      title: "Corriger une séance",
      description:
        "Corrige une séance par son id (get_summary d'un jour) : type, durée, intensité, notes, début. Un champ absent est gardé ; null efface l'intensité ou les notes.",
      inputSchema: UpdateWorkoutInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => updateWorkout(tx, input)))),
  );

  server.registerTool(
    "update_weight",
    {
      title: "Corriger une pesée",
      description: `Corrige une pesée par son id (get_summary d'un jour) : poids en kg, date-heure. ${NEUTRAL}`,
      inputSchema: UpdateWeightInput,
    },
    (input) => userErrors(async () => ok(await db((tx) => updateWeight(tx, input)))),
  );

  server.registerTool(
    "get_summary",
    {
      title: "Résumé du jour ou de la semaine",
      description: `Résumé d'un jour ou d'une semaine (lundi-dimanche, heure de Paris) : totaux nutritionnels principaux depuis Ciqual, repas, séances, pesées (moyenne sur la semaine). incomplete liste les valeurs dont le total est un minimum ; partial_values signale des aliments non comptés. Une valeur absente est « non renseignée », jamais 0. Pour un jour, chaque repas, séance et pesée a son id (delete_entry, update_workout, update_weight). ${NEUTRAL}`,
      inputSchema: SummaryInput,
      annotations: { readOnlyHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => summary(tx, input)))),
  );
}
