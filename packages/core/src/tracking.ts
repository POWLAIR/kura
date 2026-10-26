import { z } from "zod";
import type { Food, FoodMatch } from "./food-match.ts";
import { PurchaseUnit, type StockAmount, toStockAmount } from "./inventory.ts";
import { MAIN_NUTRIENTS, type MainNutrientKey } from "./nutrients.ts";
import { IdempotencyKey } from "./schemas.ts";

// Suivi : repas, séances, pesées et résumé (docs/conception.md, « Suivi alimentation »,
// « Suivi sport et poids »). Aucun objectif, aucun jugement : des chiffres.

// Fuseau des journées. Usage solo en France ; à rendre configurable avec le multi-utilisateur.
export const TIMEZONE = "Europe/Paris";

const Id = z.number().int().positive();
const IsoDate = z.iso.date();
// Avec fuseau obligatoire : « 12h30 » sans fuseau serait ambigu côté serveur (UTC).
const IsoDateTime = z.iso.datetime({ offset: true });

export const MealItemInput = z.object({
  name: z.string().trim().min(1).max(100).describe("Aliment tel que dit, ex. « riz basmati »"),
  quantity: z.number().positive().describe("Quantité dans l'unité dite"),
  unit: PurchaseUnit.describe(
    "Unité dite (g, kg, ml, cl, l, piece) : ne pas convertir soi-même en grammes",
  ),
  food_ref_id: Id.nullable()
    .optional()
    .describe(
      "Aliment de référence choisi parmi les candidats proposés ; null si aucun ne correspond",
    ),
});
export type MealItemInput = z.infer<typeof MealItemInput>;

export const LogMealInput = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Libellé du repas, ex. « Riz teriyaki aux œufs »"),
  items: z.array(MealItemInput).min(1).max(50).describe("Aliments du repas"),
  eaten_at: IsoDateTime.optional().describe("Date-heure ISO avec fuseau ; par défaut maintenant"),
  idempotency_key: IdempotencyKey.describe(
    "Identifiant unique de ce repas (ex. un UUID) : rejoué avec la même clé, l'appel ne crée pas de doublon",
  ),
});
export type LogMealInput = z.infer<typeof LogMealInput>;

const WorkoutType = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("Activité, ex. « vélo », « course »");
const DurationMin = z.number().int().positive().max(1440).describe("Durée en minutes");
const Intensity = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe("Intensité ressentie, de 1 (facile) à 5 (très dur)");
const Notes = z.string().trim().max(1000);
const WeightKg = z.number().positive().lt(500).describe("Poids en kg");

export const LogWorkoutInput = z.object({
  type: WorkoutType,
  duration_min: DurationMin,
  perceived_intensity: Intensity.optional(),
  started_at: IsoDateTime.optional().describe("Début, ISO avec fuseau ; par défaut maintenant"),
  notes: Notes.optional(),
  idempotency_key: IdempotencyKey.describe("Identifiant unique de cette séance"),
});
export type LogWorkoutInput = z.infer<typeof LogWorkoutInput>;

export const LogWeightInput = z.object({
  weight_kg: WeightKg,
  measured_at: IsoDateTime.optional().describe(
    "Date-heure ISO avec fuseau ; par défaut maintenant",
  ),
  idempotency_key: IdempotencyKey.describe("Identifiant unique de cette pesée"),
});
export type LogWeightInput = z.infer<typeof LogWeightInput>;

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

// Un repas se corrige en le supprimant puis en le ressaisissant : ses totaux dépendent
// de tous ses aliments.
export const EntryKind = z.enum(["meal", "workout", "weight"]);
export type EntryKind = z.infer<typeof EntryKind>;

const EntryId = Id.describe("Id de l'entrée, donné par get_summary pour un jour");
const nonEmpty = (changes: object) => Object.keys(changes).length > 0;
const NO_CHANGE = { message: "Aucune modification demandée" };

export const DeleteEntryInput = z.object({
  kind: EntryKind.describe("Repas, séance ou pesée"),
  id: EntryId,
});
export type DeleteEntryInput = z.infer<typeof DeleteEntryInput>;

export const UpdateWorkoutInput = z.object({
  id: EntryId,
  changes: z
    .object({
      type: WorkoutType.optional(),
      duration_min: DurationMin.optional(),
      perceived_intensity: Intensity.nullable().optional().describe("null l'efface"),
      notes: Notes.nullable().optional().describe("null les efface"),
      started_at: IsoDateTime.optional().describe("Début, ISO avec fuseau"),
    })
    .strict()
    .refine(nonEmpty, NO_CHANGE),
});
export type UpdateWorkoutInput = z.infer<typeof UpdateWorkoutInput>;

export const UpdateWeightInput = z.object({
  id: EntryId,
  changes: z
    .object({
      weight_kg: WeightKg.optional(),
      measured_at: IsoDateTime.optional().describe("Date-heure ISO avec fuseau"),
    })
    .strict()
    .refine(nonEmpty, NO_CHANGE),
});
export type UpdateWeightInput = z.infer<typeof UpdateWeightInput>;

export const SummaryInput = z.object({
  period: z.enum(["day", "week"]).describe("Jour, ou semaine du lundi au dimanche"),
  date: IsoDate.optional().describe("Un jour de la période, AAAA-MM-JJ ; par défaut aujourd'hui"),
});
export type SummaryInput = z.infer<typeof SummaryInput>;

// Poids d'une pièce ou densité d'un aliment, donnés par l'utilisateur : jamais estimés.
export const FoodConversionInput = z
  .object({
    food_ref_id: Id.describe("Aliment de référence, ex. un food_ref_id de missing_conversions"),
    piece_weight_g: z
      .number()
      .positive()
      .max(10000)
      .nullable()
      .optional()
      .describe(
        "Poids d'une pièce en grammes, tel que l'utilisateur l'a pesé ou lu sur l'emballage ; null le retire",
      ),
    density_g_ml: z
      .number()
      .positive()
      .max(3)
      .nullable()
      .optional()
      .describe("Densité en g/ml, telle que l'utilisateur l'a donnée ; null la retire"),
  })
  .strict()
  .refine((c) => c.piece_weight_g !== undefined || c.density_g_ml !== undefined, {
    message: "Donner piece_weight_g ou density_g_ml",
  });
export type FoodConversionInput = z.infer<typeof FoodConversionInput>;

// ---------------------------------------------------------------------------
// Aliments d'un repas
// ---------------------------------------------------------------------------

export type ResolvedMealItem = { name: string; food_ref_id: number | null } & StockAmount;
export type MealItemAmbiguity = {
  name: string;
  reason: "food" | "unknown_food";
  candidates: Food[];
};

// Rattache chaque aliment à food_ref : choix explicite (food_ref_id), aucun (null), ou
// rapprochement prudent par le nom. Un seul aliment ambigu suffit pour ne rien
// enregistrer : un repas n'est jamais à moitié saisi.
export function resolveMealItems(
  items: MealItemInput[],
  ctx: { foodsById: Map<number, Food>; matchFood: (name: string) => FoodMatch },
): { items: ResolvedMealItem[]; ambiguous: MealItemAmbiguity[] } {
  const resolved: ResolvedMealItem[] = [];
  const ambiguous: MealItemAmbiguity[] = [];
  for (const item of items) {
    const amount = toStockAmount(item.quantity, item.unit);
    if (item.food_ref_id === null) {
      resolved.push({ name: item.name, food_ref_id: null, ...amount });
    } else if (item.food_ref_id !== undefined) {
      if (ctx.foodsById.has(item.food_ref_id)) {
        resolved.push({ name: item.name, food_ref_id: item.food_ref_id, ...amount });
      } else {
        ambiguous.push({ name: item.name, reason: "unknown_food", candidates: [] });
      }
    } else {
      const match = ctx.matchFood(item.name);
      if (match.status === "matched") {
        resolved.push({ name: item.name, food_ref_id: match.food.id, ...amount });
      } else {
        const candidates = match.status === "unmatched" ? match.candidates : [];
        ambiguous.push({ name: item.name, reason: "food", candidates });
      }
    }
  }
  return { items: resolved, ambiguous };
}

// Aliment d'un repas tel que stocké : grams absent si la conversion a été impossible.
export type StoredMealItem = {
  name: string;
  food?: string;
  food_ref_id?: number;
  unit?: StockAmount["unit"];
  grams?: number;
};

export type MissingConversion = {
  food_ref_id: number;
  name: string;
  food: string | undefined;
  unit: "piece" | "ml";
  field: "piece_weight_g" | "density_g_ml";
};

// Aliments rattachés à food_ref mais non convertis en grammes, faute de poids par pièce
// ou de densité : la valeur est à demander à l'utilisateur, une fois par aliment et unité.
export function missingConversions(items: StoredMealItem[]): MissingConversion[] {
  const missing = new Map<string, MissingConversion>();
  for (const item of items) {
    if (item.food_ref_id === undefined || item.grams !== undefined) continue;
    if (item.unit !== "piece" && item.unit !== "ml") continue;
    const key = `${item.food_ref_id}:${item.unit}`;
    if (missing.has(key)) continue;
    missing.set(key, {
      food_ref_id: item.food_ref_id,
      name: item.name,
      food: item.food,
      unit: item.unit,
      field: item.unit === "piece" ? "piece_weight_g" : "density_g_ml",
    });
  }
  return [...missing.values()];
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

// Date du jour (AAAA-MM-JJ) dans le fuseau donné.
export function localDate(at: Date, timeZone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Premier et dernier jour (inclus) de la période contenant date ; la semaine va du lundi
// au dimanche.
export function periodRange(period: SummaryInput["period"], date: string) {
  if (period === "day") return { from: date, to: date };
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
  const from = addDays(date, -weekday);
  return { from, to: addDays(from, 6) };
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

// ---------------------------------------------------------------------------
// Totaux nutritionnels
// ---------------------------------------------------------------------------

// meal.nutrition_totals, calculé par public.meal_totals : clé absente = non renseignée ;
// incomplete = clés absentes pour une partie des aliments (le total est un minimum).
export const NutritionTotals = z.object({
  values: z.record(z.string(), z.number()),
  incomplete: z.array(z.string()),
});
export type NutritionTotals = z.infer<typeof NutritionTotals>;

export type MealNutrition = { totals: NutritionTotals; partial_values: boolean };

export type NutritionSummary = Partial<Record<MainNutrientKey, number>> & {
  // Clés dont au moins un repas n'a qu'un total minimum.
  incomplete: MainNutrientKey[];
  // Au moins un aliment non converti en grammes ou sans référence.
  partial_values: boolean;
};

// Somme des colonnes principales sur plusieurs repas, arrondie au dixième. Une clé
// renseignée dans certains repas seulement est incomplète sur la période.
export function sumNutrition(meals: MealNutrition[]): NutritionSummary {
  const summary: NutritionSummary = {
    incomplete: [],
    partial_values: meals.some((m) => m.partial_values),
  };
  for (const { key } of MAIN_NUTRIENTS) {
    const known = meals.filter((m) => m.totals.values[key] !== undefined);
    if (known.length === 0) continue;
    const total = known.reduce((sum, m) => sum + (m.totals.values[key] ?? 0), 0);
    summary[key] = Math.round(total * 10) / 10;
    if (known.length < meals.length || known.some((m) => m.totals.incomplete.includes(key))) {
      summary.incomplete.push(key);
    }
  }
  return summary;
}
