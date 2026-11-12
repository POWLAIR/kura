import {
  type DaySummary,
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
