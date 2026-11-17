import { describe, expect, it } from "vitest";
import {
  instantOf,
  type MealForm,
  mealInputOf,
  type WeightRow,
  type WorkoutRow,
  weightChangesOf,
  weightFormOf,
  weightInputOf,
  whenNow,
  whenOfInstant,
  workoutChangesOf,
  workoutFormOf,
  workoutInputOf,
} from "./forms";

const TODAY = "2026-11-12";
const KEY = "journal-0001";

describe("date et heure", () => {
  it("préremplit le jour affiché et l'heure qu'il est à Paris", () => {
    expect(whenNow("2026-11-10", new Date("2026-11-12T11:30:00Z"))).toEqual({
      date: "10/11/2026",
      time: "12:30",
    });
  });

  it("relit une date-heure enregistrée à l'heure de Paris", () => {
    expect(whenOfInstant("2026-07-14T22:05:00+00:00")).toEqual({
      date: "15/07/2026",
      time: "00:05",
    });
  });

  it("donne une date-heure avec le décalage de Paris", () => {
    expect(instantOf({ date: "12/11/2026", time: "12h30" }, TODAY)).toEqual({
      ok: true,
      value: "2026-11-12T12:30:00+01:00",
    });
  });

  it("sans année, prend la dernière fois que cette date est arrivée", () => {
    expect(instantOf({ date: "5/10", time: "8h" }, TODAY)).toEqual({
      ok: true,
      value: "2026-10-05T08:00:00+02:00",
    });
  });

  it("refuse une date ou une heure illisible", () => {
    expect(instantOf({ date: "hier", time: "12h30" }, TODAY).ok).toBe(false);
    expect(instantOf({ date: "12/11", time: "midi" }, TODAY).ok).toBe(false);
  });
});

describe("séance", () => {
  const form = {
    date: "12/11/2026",
    time: "18:15",
    type: " vélo ",
    duration: "40",
    intensity: 3,
    notes: "",
  };
  const row: WorkoutRow = {
    id: 5,
    type: "vélo",
    duration_min: 40,
    perceived_intensity: 3,
    notes: null,
    started_at: "2026-11-12T17:15:00+00:00",
  };

  it("construit l'enregistrement d'une séance", () => {
    expect(workoutInputOf(form, TODAY, KEY)).toEqual({
      ok: true,
      value: {
        type: "vélo",
        duration_min: 40,
        perceived_intensity: 3,
        started_at: "2026-11-12T18:15:00+01:00",
        idempotency_key: KEY,
      },
    });
  });

  it("laisse l'intensité et les notes de côté quand elles sont vides", () => {
    const result = workoutInputOf({ ...form, intensity: null, notes: " " }, TODAY, KEY);
    expect(result.ok && Object.keys(result.value).sort()).toEqual([
      "duration_min",
      "idempotency_key",
      "started_at",
      "type",
    ]);
  });

  it("explique ce qui manque", () => {
    expect(workoutInputOf({ ...form, type: " " }, TODAY, KEY).ok).toBe(false);
    for (const duration of ["", "0", "1,5", "une heure"]) {
      expect(workoutInputOf({ ...form, duration }, TODAY, KEY).ok, duration).toBe(false);
    }
  });

  it("ne renvoie rien quand rien n'a changé", () => {
    expect(workoutFormOf(row)).toEqual({ ...form, type: "vélo" });
    expect(workoutChangesOf(row, workoutFormOf(row), TODAY)).toEqual({ ok: true, value: null });
  });

  it("n'envoie que les champs modifiés ; null efface l'intensité ou les notes", () => {
    const noted = { ...row, notes: "vent de face" };
    const edited = {
      ...workoutFormOf(noted),
      duration: "55",
      intensity: null,
      notes: "",
      time: "19h",
    };
    expect(workoutChangesOf(noted, edited, TODAY)).toEqual({
      ok: true,
      value: {
        id: 5,
        changes: {
          duration_min: 55,
          perceived_intensity: null,
          notes: null,
          started_at: "2026-11-12T19:00:00+01:00",
        },
      },
    });
  });
});

describe("pesée", () => {
  const row: WeightRow = { id: 9, weight_kg: 72.4, measured_at: "2026-11-12T07:00:00+00:00" };

  it("construit l'enregistrement d'une pesée", () => {
    expect(weightInputOf({ date: "12/11", time: "8h", weight: "72,4" }, TODAY, KEY)).toEqual({
      ok: true,
      value: { weight_kg: 72.4, measured_at: "2026-11-12T08:00:00+01:00", idempotency_key: KEY },
    });
  });

  it("refuse un poids illisible, nul ou hors bornes", () => {
    for (const weight of ["", "0", "lourd", "600"]) {
      expect(weightInputOf({ date: "12/11", time: "8h", weight }, TODAY, KEY).ok, weight).toBe(
        false,
      );
    }
  });

  it("n'envoie que ce qui a changé", () => {
    expect(weightFormOf(row)).toEqual({ date: "12/11/2026", time: "08:00", weight: "72,4" });
    expect(weightChangesOf(row, weightFormOf(row), TODAY)).toEqual({ ok: true, value: null });
    expect(weightChangesOf(row, { ...weightFormOf(row), weight: "72,1" }, TODAY)).toEqual({
      ok: true,
      value: { id: 9, changes: { weight_kg: 72.1 } },
    });
  });
});

describe("repas", () => {
  const form: MealForm = {
    date: "12/11/2026",
    time: "12:30",
    label: " Riz aux œufs ",
    items: [
      { key: "a", name: "Riz blanc, cuit", foodRefId: 12, quantity: "200", unit: "g" },
      { key: "b", name: "Œuf, cru", foodRefId: 30, quantity: "2", unit: "piece" },
      { key: "c", name: "Sauce maison", foodRefId: null, quantity: "1,5", unit: "cl" },
    ],
  };

  it("construit l'enregistrement d'un repas, dans les unités dites", () => {
    expect(mealInputOf(form, TODAY, KEY)).toEqual({
      ok: true,
      value: {
        label: "Riz aux œufs",
        items: [
          { name: "Riz blanc, cuit", quantity: 200, unit: "g", food_ref_id: 12 },
          { name: "Œuf, cru", quantity: 2, unit: "piece", food_ref_id: 30 },
          { name: "Sauce maison", quantity: 1.5, unit: "cl", food_ref_id: null },
        ],
        eaten_at: "2026-11-12T12:30:00+01:00",
        idempotency_key: KEY,
      },
    });
  });

  it("explique ce qui manque", () => {
    expect(mealInputOf({ ...form, label: "" }, TODAY, KEY)).toEqual({
      ok: false,
      message: "Donne un nom au repas.",
    });
    expect(mealInputOf({ ...form, items: [] }, TODAY, KEY).ok).toBe(false);
    const [rice] = form.items;
    expect(
      mealInputOf({ ...form, items: [{ ...rice, quantity: "" } as never] }, TODAY, KEY),
    ).toEqual({
      ok: false,
      message: "« Riz blanc, cuit » : indique la quantité mangée.",
    });
  });
});
