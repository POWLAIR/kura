import { describe, expect, it } from "vitest";
import {
  type DaySummary,
  dayLabel,
  localTime,
  nutritionBrief,
  nutritionRows,
  parseTimeInput,
  shiftDay,
  shortDayLabel,
  timelineOf,
  zonedIso,
} from "./journal-view.ts";
import { LogWeightInput } from "./tracking.ts";

describe("nutritionRows", () => {
  it("écrit chaque valeur principale : chiffre, minimum ou non renseignée", () => {
    const rows = nutritionRows({
      energy_kcal: 539,
      protein_g: 12.5,
      carbs_g: 57.5,
      incomplete: ["protein_g"],
      partial_values: false,
    });
    expect(rows.map((row) => [row.label, row.text])).toEqual([
      ["Énergie", "539 kcal"],
      ["Protéines", "au moins 12,5 g"],
      ["Glucides", "57,5 g"],
      ["dont sucres", "non renseignée"],
      ["Lipides", "non renseignée"],
      ["dont acides gras saturés", "non renseignée"],
      ["Fibres", "non renseignée"],
      ["Sel", "non renseignée"],
    ]);
    expect(rows.filter((row) => row.detail).map((row) => row.key)).toEqual([
      "sugars_g",
      "saturated_fat_g",
    ]);
  });

  it("garde un zéro déclaré : ce n'est pas une valeur absente", () => {
    const [, , , , , , fiber] = nutritionRows({
      fiber_g: 0,
      incomplete: [],
      partial_values: false,
    });
    expect([fiber?.text, fiber?.known]).toEqual(["0 g", true]);
  });
});

describe("nutritionBrief", () => {
  it("résume les valeurs connues sur une ligne", () => {
    expect(
      nutritionBrief({
        energy_kcal: 539,
        protein_g: 6.3,
        fat_g: 30.9,
        salt_g: 0.1,
        incomplete: ["fat_g"],
        partial_values: false,
      }),
    ).toBe("539 kcal · protéines 6,3 g · lipides au moins 30,9 g");
  });

  it("le dit quand rien n'est renseigné", () => {
    expect(nutritionBrief({ incomplete: [], partial_values: true })).toBe(
      "Valeurs non renseignées",
    );
  });
});

describe("timelineOf", () => {
  const day: DaySummary = {
    period: "day",
    from: "2026-11-12",
    to: "2026-11-12",
    timezone: "Europe/Paris",
    nutrition: { incomplete: [], partial_values: true },
    workout_minutes: 40,
    meals: [
      { id: 2, time: "12:30", label: "Riz aux œufs", partial_values: true },
      { id: 1, time: "08:00", label: "Tartines", partial_values: false },
    ],
    workouts: [
      { id: 5, time: "18:15", type: "vélo", duration_min: 40, perceived_intensity: 3 },
      { id: 6, time: "07:00", type: "étirements", duration_min: 10 },
    ],
    weights: [{ id: 9, time: "08:00", weight_kg: 72.4 }],
  };

  it("mêle repas, séances et pesées dans l'ordre de la journée", () => {
    expect(timelineOf(day).map((e) => [e.time, e.kind, e.title, e.detail])).toEqual([
      ["07:00", "workout", "étirements", "10 min"],
      ["08:00", "meal", "Tartines", null],
      ["08:00", "weight", "Pesée", "72,4 kg"],
      ["12:30", "meal", "Riz aux œufs", "Valeurs partielles"],
      ["18:15", "workout", "vélo", "40 min · intensité 3/5"],
    ]);
  });

  it("donne une frise vide pour un jour sans rien", () => {
    expect(timelineOf({ ...day, meals: [], workouts: [], weights: [] })).toEqual([]);
  });
});

describe("jours", () => {
  it("avance et recule d'un jour, y compris en fin de mois et au changement d'heure", () => {
    expect(shiftDay("2026-11-12", 1)).toBe("2026-11-13");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-10-25", 1)).toBe("2026-10-26");
    expect(shiftDay("2026-12-31", 7)).toBe("2027-01-07");
  });

  it("nomme le jour", () => {
    expect(dayLabel("2026-11-12", "2026-11-12")).toBe("Aujourd'hui");
    expect(dayLabel("2026-11-11", "2026-11-12")).toBe("Hier");
    expect(dayLabel("2026-11-09", "2026-11-12")).toBe("lundi 9 novembre");
    expect(shortDayLabel("2026-11-12")).toBe("jeu. 12");
  });
});

describe("parseTimeInput", () => {
  it("lit les façons courantes d'écrire une heure", () => {
    expect(parseTimeInput("12h30")).toBe("12:30");
    expect(parseTimeInput("12:30")).toBe("12:30");
    expect(parseTimeInput("1230")).toBe("12:30");
    expect(parseTimeInput(" 8h ")).toBe("08:00");
    expect(parseTimeInput("8")).toBe("08:00");
    expect(parseTimeInput("0h05")).toBe("00:05");
    expect(parseTimeInput("19 H 45")).toBe("19:45");
  });

  it("refuse ce qui n'est pas une heure", () => {
    for (const input of ["", "24h", "12h60", "midi", "12h3", "123456"]) {
      expect(parseTimeInput(input), input).toBeNull();
    }
  });
});

describe("zonedIso", () => {
  it("donne le décalage de Paris, l'hiver comme l'été", () => {
    expect(zonedIso("2026-11-12", "12:30")).toBe("2026-11-12T12:30:00+01:00");
    expect(zonedIso("2026-07-14", "08:05")).toBe("2026-07-14T08:05:00+02:00");
    expect(new Date(zonedIso("2026-11-12", "12:30")).toISOString()).toBe(
      "2026-11-12T11:30:00.000Z",
    );
  });

  it("suit le changement d'heure le jour même", () => {
    // 25 octobre 2026 : retour à l'heure d'hiver à 3 h.
    expect(zonedIso("2026-10-25", "01:30")).toBe("2026-10-25T01:30:00+02:00");
    expect(zonedIso("2026-10-25", "04:00")).toBe("2026-10-25T04:00:00+01:00");
    // 29 mars 2026 : passage à l'heure d'été à 2 h.
    expect(zonedIso("2026-03-29", "01:30")).toBe("2026-03-29T01:30:00+01:00");
    expect(zonedIso("2026-03-29", "03:30")).toBe("2026-03-29T03:30:00+02:00");
  });

  it("gère un autre fuseau et produit une date acceptée par les opérations log_*", () => {
    expect(zonedIso("2026-11-12", "12:30", "America/New_York")).toBe("2026-11-12T12:30:00-05:00");
    expect(zonedIso("2026-11-12", "12:30", "Asia/Kolkata")).toBe("2026-11-12T12:30:00+05:30");
    const input = {
      weight_kg: 72.4,
      measured_at: zonedIso("2026-11-12", "07:45"),
      idempotency_key: "pesee-0001",
    };
    expect(LogWeightInput.safeParse(input).success).toBe(true);
  });

  it("donne l'heure courante à Paris", () => {
    expect(localTime(new Date("2026-11-12T11:30:00Z"))).toBe("12:30");
    expect(localTime(new Date("2026-07-14T22:05:00Z"))).toBe("00:05");
  });
});
