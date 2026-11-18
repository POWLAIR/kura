import { describe, expect, it } from "vitest";
import { micronutrientRows } from "./journal-view.ts";
import { NUTRIENT_INFO, NUTRIENT_SOURCES } from "./nutrient-info.ts";
import { MAIN_NUTRIENTS, MICRONUTRIENTS } from "./nutrients.ts";
import { sumMicronutrients } from "./tracking.ts";

const KEYS = [...MAIN_NUTRIENTS, ...MICRONUTRIENTS].map((n) => n.key);

describe("fiches « À quoi ça sert »", () => {
  it.each(KEYS)("%s : une fiche de deux ou trois phrases, avec ses sources", (key) => {
    const info = NUTRIENT_INFO[key];
    const sentences = info.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(info.sources.length).toBeGreaterThan(0);
    for (const source of info.sources) expect(NUTRIENT_SOURCES[source].url).toMatch(/^https:\/\//);
  });

  // Même règle de ton que le compagnon : le rôle d'une valeur, jamais un jugement ni un
  // objectif sur ce qu'on mange.
  const JUDGEMENT =
    /\b(trop|excès|excessi\w*|mauvais\w*|néfaste\w*|danger\w*|objectif\w*|limiter|éviter|grossi\w*|maigri\w*|régime|recommandé\w*|par jour)\b/i;
  it.each(KEYS)("%s : aucun mot qui juge ou fixe un objectif", (key) => {
    expect(NUTRIENT_INFO[key].text).not.toMatch(JUDGEMENT);
  });
});

describe("vitamines et minéraux", () => {
  const meal = (values: Record<string, number>, incomplete: string[] = []) => ({
    totals: { values, incomplete },
    partial_values: false,
  });

  it("sumMicronutrients : somme, minimum quand une partie manque", () => {
    expect(
      sumMicronutrients([meal({ iron_mg: 1.234, vitamin_d_ug: 0.05 }), meal({ iron_mg: 2 })]),
    ).toEqual({ values: { iron_mg: 3.23, vitamin_d_ug: 0.05 }, incomplete: ["vitamin_d_ug"] });
  });

  it("micronutrientRows : les plus courants d'abord, « non renseignée » sinon", () => {
    const rows = micronutrientRows({ values: { calcium_mg: 120.5 }, incomplete: ["calcium_mg"] });
    expect(rows.slice(0, 2).map((r) => [r.label, r.text])).toEqual([
      ["Fer", "non renseignée"],
      ["Calcium", "au moins 120,5 mg"],
    ]);
    expect(rows).toHaveLength(MICRONUTRIENTS.length);
  });
});
