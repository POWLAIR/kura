import {
  type DaySummary,
  localDate,
  localTime,
  mealNutritionOf,
  type NutritionSummary,
  sumNutrition,
  type WeekSummary,
} from "@kura/core";
import { callApi } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { WeightRow, WorkoutRow } from "./forms";

// Lectures du journal. Le résumé vient de l'opération get_summary (journées à l'heure de
// Paris, comme pour Claude) ; le détail d'une entrée est lu directement, sous RLS.

export type DayView = { summary: DaySummary; mealNutrition: Map<number, NutritionSummary> };

export async function fetchDay(date: string): Promise<DayView> {
  const summary = await callApi<DaySummary>("get_summary", { period: "day", date });
  const mealNutrition = new Map<number, NutritionSummary>();
  const ids = summary.meals.map((meal) => meal.id);
  if (ids.length > 0) {
    // Valeurs de chaque repas : celles que la base a calculées, jamais recalculées ici.
    const { data, error } = await supabase
      .from("meal")
      .select("id, nutrition_totals, partial_values")
      .in("id", ids);
    if (error) throw error;
    for (const row of data ?? []) {
      mealNutrition.set(row.id, sumNutrition([mealNutritionOf(row)]));
    }
  }
  return { summary, mealNutrition };
}

export function fetchWeek(date: string): Promise<WeekSummary> {
  return callApi<WeekSummary>("get_summary", { period: "week", date });
}

export async function fetchWorkout(id: number): Promise<WorkoutRow | null> {
  const { data, error } = await supabase
    .from("workout")
    .select("id, type, duration_min, perceived_intensity, notes, started_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchWeight(id: number): Promise<WeightRow | null> {
  const { data, error } = await supabase
    .from("body_measure")
    .select("id, weight_kg, measured_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type MealDetail = {
  id: number;
  label: string;
  when: string; // « jeudi 12 novembre, 12:30 », à l'heure de Paris
  nutrition: NutritionSummary;
  items: {
    id: number;
    name: string;
    quantity: number | null;
    unit: "g" | "ml" | "piece" | null;
    grams: number | null;
    food: string | null; // aliment de référence ; null : non compté
  }[];
};

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// Un repas et ses aliments, lus sous RLS. Les valeurs sont celles que la base a calculées.
export async function fetchMeal(id: number): Promise<MealDetail | null> {
  const { data: meal, error } = await supabase
    .from("meal")
    .select("id, label, eaten_at, nutrition_totals, partial_values")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!meal) return null;
  const { data: items, error: itemsError } = await supabase
    .from("meal_item")
    .select("id, name, quantity, unit, quantity_g, food_ref_id, food_ref(name)")
    .eq("meal_id", id)
    .order("id");
  if (itemsError) throw itemsError;
  const at = new Date(meal.eaten_at);
  return {
    id: meal.id,
    label: meal.label,
    when: `${longDay.format(new Date(`${localDate(at)}T00:00:00Z`))}, ${localTime(at)}`,
    nutrition: sumNutrition([mealNutritionOf(meal)]),
    items: (items ?? []).map((item) => {
      const food = (item.food_ref as { name: string } | null)?.name ?? null;
      return {
        id: item.id,
        name: item.name ?? food ?? "Aliment",
        quantity: item.quantity,
        unit: item.unit,
        grams: item.quantity_g,
        food,
      };
    }),
  };
}
