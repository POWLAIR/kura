import { describe, expect, it } from "vitest";
import {
  createFoodMatcher,
  type Food,
  matchFoods,
  normalizeFoodName,
  similarByName,
} from "./food-match.ts";

const foods: Food[] = [
  "Moutarde",
  "Moutarde à l'ancienne",
  "Thym, frais",
  "Thym, séché",
  "Clou de girofle",
  "Cannelle, poudre",
  "Oeuf cru",
  "Oeuf, en poudre",
  "Haricot beurre, cru",
  "Beurre à 80% MG, salé",
  "Pâté en croûte",
  "Ratatouille cuisinée, préemballée",
].map((name, i) => ({ id: i + 1, code: String(1000 + i), name }));

const names = (list: Food[]) => list.map((f) => f.name);
const match = createFoodMatcher(foods);

describe("normalizeFoodName", () => {
  it.each([
    ["Œufs", "oeuf"],
    ["Clous de girofle", "clou de girofle"],
    ["Pâte d'arachide", "pate d arachide"],
    ["Riz", "riz"],
  ])("« %s » → « %s »", (raw, expected) => {
    expect(normalizeFoodName(raw)).toBe(expected);
  });
});

describe("createFoodMatcher", () => {
  it.each([
    ["Moutarde", "Moutarde"], // nom exact, même si d'autres moutardes existent
    ["Clous de girofle", "Clou de girofle"], // pluriel
    ["Cannelle", "Cannelle, poudre"], // seul aliment de ce nom
  ])("lie « %s » à « %s »", (query, expected) => {
    expect(match(query)).toMatchObject({ status: "matched", by: "nom", food: { name: expected } });
  });

  it("ne choisit pas une entrée générique quand des variantes existent", () => {
    const rice = createFoodMatcher(
      ["Riz, mélange de variétés, cru", "Riz blanc, cru", "Riz thaï, cru"].map((name, i) => ({
        id: i + 1,
        code: String(i + 1),
        name,
      })),
    );
    expect(rice("Riz")).toMatchObject({ status: "unmatched" });
  });

  it("ne choisit pas entre deux formes du même aliment", () => {
    const result = match("Thym");
    expect(result.status).toBe("unmatched");
    if (result.status === "unmatched") {
      expect(names(result.candidates)).toEqual(["Thym, frais", "Thym, séché"]);
    }
  });

  it("classe d'abord les candidats qui commencent par l'aliment cherché", () => {
    const result = match("Beurre");
    expect(result.status === "unmatched" && names(result.candidates)[0]).toBe(
      "Beurre à 80% MG, salé",
    );
  });

  it("ignore les mots outils pour proposer des candidats", () => {
    expect(match("Ratatouille en bocal")).toEqual({
      status: "unmatched",
      candidates: [expect.objectContaining({ name: "Ratatouille cuisinée, préemballée" })],
    });
    expect(match("Yuzu")).toEqual({ status: "unmatched", candidates: [] });
  });
});

describe("matchFoods", () => {
  it("applique les choix manuels avant le rapprochement par nom", () => {
    const result = matchFoods(["Thym", "Yuzu", "Moutarde"], foods, { Thym: "1003", Yuzu: null });
    expect(result.get("Thym")).toMatchObject({
      status: "matched",
      by: "choix",
      food: { code: "1003" },
    });
    expect(result.get("Yuzu")).toEqual({ status: "excluded" });
    expect(result.get("Moutarde")).toMatchObject({ status: "matched", by: "nom" });
  });

  it("refuse un choix pour un article absent ou un code inconnu", () => {
    expect(() => matchFoods(["Thym"], foods, { Tym: "1003" })).toThrow(/absent de la page/);
    expect(() => matchFoods(["Thym"], foods, { Thym: "99999" })).toThrow(/absent de food_ref/);
  });
});

describe("similarByName", () => {
  const items = [
    { id: 1, name: "Riz long" },
    { id: 2, name: "Farine de riz" },
    { id: 3, name: "Sauce soja" },
  ];

  it("propose les articles qui partagent un mot, celui qui commence par ce mot d'abord", () => {
    expect(similarByName("riz basmati", items).map((i) => i.id)).toEqual([1, 2]);
    expect(similarByName("yuzu", items)).toEqual([]);
  });
});
