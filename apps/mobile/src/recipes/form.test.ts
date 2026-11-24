import { describe, expect, it } from "vitest";
import { emptyIngredient, type RecipeForm, recipeInput } from "./form";

const form = (changes: Partial<RecipeForm> = {}): RecipeForm => ({
  title: "Gomasio",
  servings: "4",
  minutes: "",
  steps: "Griller le sésame.\n\n Piler avec le sel. ",
  ingredients: [
    { ...emptyIngredient(), name: "sésame", quantity: "1,5", unit: "g" },
    { ...emptyIngredient(), name: "sel", quantity: "", unit: "none", food_ref_id: null },
    { ...emptyIngredient(), name: " " },
  ],
  ...changes,
});

describe("recipeInput", () => {
  it("construit l'entrée de save_recipe, origin manuelle", () => {
    expect(recipeInput(form())).toEqual({
      ok: true,
      value: {
        title: "Gomasio",
        servings: 4,
        steps: ["Griller le sésame.", "Piler avec le sel."],
        ingredients: [
          { name: "sésame", quantity: 1.5, unit: "g" },
          { name: "sel", food_ref_id: null },
        ],
        origin: "manuelle",
      },
    });
  });

  it.each([
    [{ title: " " }, "Donne un titre à la recette."],
    [{ servings: "1,5" }, "Portions : un nombre entier, au moins 1."],
    [{ minutes: "vite" }, "Temps : un nombre de minutes."],
    [{ ingredients: [] }, "Ajoute au moins un ingrédient."],
    [
      { ingredients: [{ ...emptyIngredient(), name: "riz", quantity: "", unit: "g" as const }] },
      "« riz » : une quantité, ou « à votre goût ».",
    ],
  ])("refuse %o", (changes, message) => {
    expect(recipeInput(form(changes))).toEqual({ ok: false, message });
  });
});
