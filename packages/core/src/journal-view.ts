import { MAIN_NUTRIENTS, type MainNutrientKey } from "./nutrients.ts";
import { type NutritionSummary, TIMEZONE } from "./tracking.ts";

// Affichage du journal, partagé par les écrans de l'app : résumé d'un jour ou d'une semaine
// tel que le renvoie get_summary, frise du jour, valeurs nutritionnelles, saisie d'une heure.
// Règle de ton : des faits, sans objectif, sans jugement, sans code couleur.

// ---------------------------------------------------------------------------
// Réponses de get_summary
// ---------------------------------------------------------------------------

type SummaryBase = {
  from: string;
  to: string;
  timezone: string;
  nutrition: NutritionSummary;
  workout_minutes: number;
};

export type SummaryMeal = { id: number; time: string; label: string; partial_values: boolean };
export type SummaryWorkout = {
  id: number;
  time: string;
  type: string;
  duration_min: number;
  perceived_intensity?: number;
};
export type SummaryWeight = { id: number; time: string; weight_kg: number };

export type DaySummary = SummaryBase & {
  period: "day";
  meals: SummaryMeal[];
  workouts: SummaryWorkout[];
  weights: SummaryWeight[];
};

export type WeekSummary = SummaryBase & {
  period: "week";
  days: { date: string; meals: number; nutrition: NutritionSummary; workout_minutes: number }[];
  workouts: (SummaryWorkout & { day: string })[];
  weight?: { average_kg: number; measures: number };
};

// ---------------------------------------------------------------------------
// Valeurs nutritionnelles
// ---------------------------------------------------------------------------

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export type NutritionRow = {
  key: MainNutrientKey;
  label: string;
  // « 539 kcal », « au moins 12,5 g » (total minimum), ou « non renseignée ».
  text: string;
  known: boolean;
  // Ligne de détail (« dont sucres ») : affichée en retrait.
  detail: boolean;
};

// Les valeurs principales, dans l'ordre de la conception. Une valeur absente est « non
// renseignée », jamais zéro ; un total dont il manque une partie est un minimum.
export function nutritionRows(summary: NutritionSummary): NutritionRow[] {
  return MAIN_NUTRIENTS.map(({ key, label, unit }) => {
    const value = summary[key];
    const known = value !== undefined;
    const amount = known ? `${decimal.format(value)} ${unit}` : "non renseignée";
    return {
      key,
      label,
      text: known && summary.incomplete.includes(key) ? `au moins ${amount}` : amount,
      known,
      detail: label.startsWith("dont "),
    };
  });
}

const BRIEF_KEYS = ["energy_kcal", "protein_g", "carbs_g", "fat_g"] as const;

// Les quatre valeurs les plus lues, sur une ligne : « 539 kcal · protéines 6,3 g · … ».
// Celles qui ne sont pas renseignées sont omises ; aucune ne l'est : « Valeurs non
// renseignées ».
export function nutritionBrief(summary: NutritionSummary): string {
  const parts = nutritionRows(summary)
    .filter((row) => row.known && (BRIEF_KEYS as readonly string[]).includes(row.key))
    .map((row) =>
      row.key === "energy_kcal" ? row.text : `${row.label.toLowerCase()} ${row.text}`,
    );
  return parts.length > 0 ? parts.join(" · ") : "Valeurs non renseignées";
}

// ---------------------------------------------------------------------------
// Frise d'un jour
// ---------------------------------------------------------------------------

export type TimelineEntry = {
  kind: "meal" | "workout" | "weight";
  id: number;
  time: string; // HH:MM, heure de Paris
  title: string;
  detail: string | null;
};

const KIND_ORDER = { meal: 0, workout: 1, weight: 2 } as const;

// Repas, séances et pesées d'un jour, dans l'ordre de la journée.
export function timelineOf(day: DaySummary): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...day.meals.map((meal) => ({
      kind: "meal" as const,
      id: meal.id,
      time: meal.time,
      title: meal.label,
      detail: meal.partial_values ? "Valeurs partielles" : null,
    })),
    ...day.workouts.map((workout) => ({
      kind: "workout" as const,
      id: workout.id,
      time: workout.time,
      title: workout.type,
      detail: [
        `${workout.duration_min} min`,
        workout.perceived_intensity ? `intensité ${workout.perceived_intensity}/5` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...day.weights.map((weight) => ({
      kind: "weight" as const,
      id: weight.id,
      time: weight.time,
      title: "Pesée",
      detail: `${decimal.format(weight.weight_kg)} kg`,
    })),
  ];
  return entries.sort(
    (a, b) =>
      a.time.localeCompare(b.time) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id,
  );
}

// ---------------------------------------------------------------------------
// Dates et heures
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const shortDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
});

// « jeudi 12 novembre », ou « Aujourd'hui » et « Hier » par rapport à `today`.
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Aujourd'hui";
  if (date === shiftDay(today, -1)) return "Hier";
  return longDay.format(new Date(`${date}T00:00:00Z`));
}

// « jeu. 12 », pour une ligne de la semaine.
export function shortDayLabel(date: string): string {
  return shortDay.format(new Date(`${date}T00:00:00Z`));
}

// Heure tapée : « 12h30 », « 12:30 », « 1230 », « 8h », « 8 ». Renvoie HH:MM, ou null.
export function parseTimeInput(input: string): string | null {
  const match = /^(\d{1,2})(?:\s*[h:.]\s*(\d{2})?|(\d{2}))?$/i.exec(input.trim());
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2] ?? match[3] ?? 0)];
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Heure courante (HH:MM) dans le fuseau donné.
export function localTime(at: Date, timeZone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

// Décalage du fuseau à cet instant, en minutes (Paris : +60 l'hiver, +120 l'été).
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((wall - at.getTime()) / 60_000);
}

// Date (AAAA-MM-JJ) et heure (HH:MM) dans le fuseau donné → date-heure ISO avec son
// décalage (« 2026-11-12T12:30:00+01:00 »), comme l'exigent les opérations log_*.
export function zonedIso(date: string, time: string, timeZone: string = TIMEZONE): string {
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  // Le décalage dépend de l'instant : on l'estime, puis on le relit à l'instant corrigé
  // (les deux diffèrent seulement autour d'un changement d'heure).
  let offset = offsetMinutes(new Date(asUtc), timeZone);
  offset = offsetMinutes(new Date(asUtc - offset * 60_000), timeZone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}
