import {
  formatDateInput,
  LogMealInput,
  LogWeightInput,
  LogWorkoutInput,
  localDate,
  localTime,
  type PurchaseUnit,
  parseDateInput,
  parseTimeInput,
  UpdateWeightInput,
  UpdateWorkoutInput,
  zonedIso,
} from "@kura/core";
import { type FormResult, parseQuantity } from "@/inventory/item-form";

// Formulaires de l'onglet Journal : du texte saisi aux entrées des opérations log_* et
// update_*, validées par les schémas Zod de @kura/core. Sans React : testé avec Vitest.

const fail = (message: string): FormResult<never> => ({ ok: false, message });

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Saisie invalide.";
}

// ---------------------------------------------------------------------------
// Date et heure, à Paris
// ---------------------------------------------------------------------------

export type WhenForm = { date: string; time: string };

// Champs préremplis : le jour affiché dans le journal, et l'heure qu'il est.
export function whenNow(day: string, now: Date): WhenForm {
  return { date: formatDateInput(day), time: localTime(now) };
}

// Champs préremplis depuis une date-heure enregistrée.
export function whenOfInstant(iso: string): WhenForm {
  const at = new Date(iso);
  return { date: formatDateInput(localDate(at)), time: localTime(at) };
}

// Date-heure ISO avec le décalage de Paris, comme l'attendent les opérations.
export function instantOf(form: WhenForm, today: string): FormResult<string> {
  const date = parseDateInput(form.date, today, { past: true });
  if (date === null) return fail("Date : écris-la comme 12/11 ou 12/11/2026.");
  const time = parseTimeInput(form.time);
  if (time === null) return fail("Heure : écris-la comme 12h30.");
  return { ok: true, value: zonedIso(date, time) };
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

// ---------------------------------------------------------------------------
// Séance
// ---------------------------------------------------------------------------

export type WorkoutForm = WhenForm & {
  type: string;
  duration: string; // minutes
  intensity: number | null; // 1 à 5, ou non renseignée
  notes: string;
};

// Séance telle que la lit l'app dans la table workout.
export type WorkoutRow = {
  id: number;
  type: string;
  duration_min: number;
  perceived_intensity: number | null;
  notes: string | null;
  started_at: string;
};

export function workoutFormOf(row: WorkoutRow): WorkoutForm {
  return {
    ...whenOfInstant(row.started_at),
    type: row.type,
    duration: String(row.duration_min),
    intensity: row.perceived_intensity,
    notes: row.notes ?? "",
  };
}

function durationOf(text: string): number | null {
  return /^\d+$/.test(text.trim()) && Number(text) > 0 ? Number(text) : null;
}

export function workoutInputOf(
  form: WorkoutForm,
  today: string,
  idempotencyKey: string,
): FormResult<LogWorkoutInput> {
  if (form.type.trim() === "") return fail("Indique l'activité : vélo, course, yoga…");
  const duration = durationOf(form.duration);
  if (duration === null) return fail("Durée : un nombre de minutes est attendu.");
  const startedAt = instantOf(form, today);
  if (!startedAt.ok) return startedAt;

  const parsed = LogWorkoutInput.safeParse({
    type: form.type,
    duration_min: duration,
    started_at: startedAt.value,
    idempotency_key: idempotencyKey,
    ...(form.intensity !== null && { perceived_intensity: form.intensity }),
    ...(form.notes.trim() !== "" && { notes: form.notes }),
  });
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}

// Les seuls champs modifiés, pour update_workout ; null s'il n'y a rien à enregistrer.
export function workoutChangesOf(
  row: WorkoutRow,
  form: WorkoutForm,
  today: string,
): FormResult<UpdateWorkoutInput | null> {
  if (form.type.trim() === "") return fail("Indique l'activité : vélo, course, yoga…");
  const duration = durationOf(form.duration);
  if (duration === null) return fail("Durée : un nombre de minutes est attendu.");
  const startedAt = instantOf(form, today);
  if (!startedAt.ok) return startedAt;

  const changes: Record<string, unknown> = {};
  if (form.type.trim() !== row.type) changes.type = form.type;
  if (duration !== row.duration_min) changes.duration_min = duration;
  if (form.intensity !== row.perceived_intensity) changes.perceived_intensity = form.intensity;
  const notes = form.notes.trim() === "" ? null : form.notes.trim();
  if (notes !== row.notes) changes.notes = notes;
  if (!sameInstant(startedAt.value, row.started_at)) changes.started_at = startedAt.value;

  if (Object.keys(changes).length === 0) return { ok: true, value: null };
  const parsed = UpdateWorkoutInput.safeParse({ id: row.id, changes });
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}

// ---------------------------------------------------------------------------
// Pesée
// ---------------------------------------------------------------------------

export type WeightForm = WhenForm & { weight: string };

export type WeightRow = { id: number; weight_kg: number; measured_at: string };

export function weightFormOf(row: WeightRow): WeightForm {
  return { ...whenOfInstant(row.measured_at), weight: String(row.weight_kg).replace(".", ",") };
}

function weightOf(text: string): number | null {
  const weight = parseQuantity(text);
  return weight !== null && weight > 0 ? weight : null;
}

export function weightInputOf(
  form: WeightForm,
  today: string,
  idempotencyKey: string,
): FormResult<LogWeightInput> {
  const weight = weightOf(form.weight);
  if (weight === null) return fail("Poids : un nombre en kg est attendu, par exemple 72,4.");
  const measuredAt = instantOf(form, today);
  if (!measuredAt.ok) return measuredAt;
  const parsed = LogWeightInput.safeParse({
    weight_kg: weight,
    measured_at: measuredAt.value,
    idempotency_key: idempotencyKey,
  });
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}

export function weightChangesOf(
  row: WeightRow,
  form: WeightForm,
  today: string,
): FormResult<UpdateWeightInput | null> {
  const weight = weightOf(form.weight);
  if (weight === null) return fail("Poids : un nombre en kg est attendu, par exemple 72,4.");
  const measuredAt = instantOf(form, today);
  if (!measuredAt.ok) return measuredAt;

  const changes: Record<string, unknown> = {};
  if (weight !== row.weight_kg) changes.weight_kg = weight;
  if (!sameInstant(measuredAt.value, row.measured_at)) changes.measured_at = measuredAt.value;

  if (Object.keys(changes).length === 0) return { ok: true, value: null };
  const parsed = UpdateWeightInput.safeParse({ id: row.id, changes });
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}

// ---------------------------------------------------------------------------
// Repas
// ---------------------------------------------------------------------------

export type MealItemForm = {
  key: string;
  name: string;
  // Aliment de référence choisi (recherche ou scan) ; null : aucun, l'aliment ne sera pas
  // compté et le repas sera « valeurs partielles ».
  foodRefId: number | null;
  quantity: string;
  unit: PurchaseUnit;
};

export type MealForm = WhenForm & { label: string; items: MealItemForm[] };

export function mealInputOf(
  form: MealForm,
  today: string,
  idempotencyKey: string,
): FormResult<LogMealInput> {
  if (form.label.trim() === "") return fail("Donne un nom au repas.");
  if (form.items.length === 0) return fail("Ajoute au moins un aliment.");
  const eatenAt = instantOf(form, today);
  if (!eatenAt.ok) return eatenAt;

  const items = [];
  for (const item of form.items) {
    const quantity = parseQuantity(item.quantity);
    if (quantity === null || quantity === 0) {
      return fail(`« ${item.name} » : indique la quantité mangée.`);
    }
    items.push({ name: item.name, quantity, unit: item.unit, food_ref_id: item.foodRefId });
  }

  const parsed = LogMealInput.safeParse({
    label: form.label,
    items,
    eaten_at: eatenAt.value,
    idempotency_key: idempotencyKey,
  });
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}
