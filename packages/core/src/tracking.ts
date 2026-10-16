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

export const LogWorkoutInput = z.object({
  type: z.string().trim().min(1).max(100).describe("Activité, ex. « vélo », « course »"),
  duration_min: z.number().int().positive().max(1440).describe("Durée en minutes"),
  perceived_intensity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Intensité ressentie, de 1 (facile) à 5 (très dur)"),
  started_at: IsoDateTime.optional().describe("Début, ISO avec fuseau ; par défaut maintenant"),
  notes: z.string().trim().max(1000).optional(),
  idempotency_key: IdempotencyKey.describe("Identifiant unique de cette séance"),
});
export type LogWorkoutInput = z.infer<typeof LogWorkoutInput>;

export const LogWeightInput = z.object({
  weight_kg: z.number().positive().lt(500).describe("Poids en kg"),
  measured_at: IsoDateTime.optional().describe(
    "Date-heure ISO avec fuseau ; par défaut maintenant",
  ),
  idempotency_key: IdempotencyKey.describe("Identifiant unique de cette pesée"),
});
export type LogWeightInput = z.infer<typeof LogWeightInput>;

export const SummaryInput = z.object({
  period: z.enum(["day", "week"]).describe("Jour, ou semaine du lundi au dimanche"),
  date: IsoDate.optional().describe("Un jour de la période, AAAA-MM-JJ ; par défaut aujourd'hui"),
});
export type SummaryInput = z.infer<typeof SummaryInput>;

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
