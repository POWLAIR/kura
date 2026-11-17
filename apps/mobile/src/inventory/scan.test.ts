import type { AddItemsResult } from "@kura/core";
import { describe, expect, it } from "vitest";
import type { InventoryRow } from "./item-form";
import {
  acceptScan,
  lineFromProduct,
  locationOf,
  manualLine,
  mergeSummaries,
  purchasesOf,
  RESCAN_DELAY_MS,
  remainingLines,
  rescanned,
  type ScannedFood,
  summaryOf,
} from "./scan";

const nutella: ScannedFood = {
  id: 40,
  code: "3017620422003",
  name: "Nutella",
  brand: "Ferrero",
  package_quantity: 400,
  package_unit: "g",
};
const soySauce: ScannedFood = {
  ...nutella,
  id: 41,
  code: "8715035110106",
  name: "Sauce soja",
  package_quantity: 150,
  package_unit: "ml",
};
const eggs: ScannedFood = {
  ...nutella,
  id: 42,
  code: "3270190207924",
  name: "Œufs bio",
  package_quantity: null,
  package_unit: null,
};

const row = (overrides: Partial<InventoryRow>): InventoryRow => ({
  id: 1,
  name: "Article",
  category: "feculents",
  location: "placard",
  quantity: null,
  unit: null,
  level: "plein",
  expires_on: null,
  restock_threshold: null,
  restock_level: null,
  food_ref_id: null,
  food_name: null,
  low_stock: false,
  ...overrides,
});

const spread = row({
  id: 7,
  name: "Pâte à tartiner",
  category: "sauces",
  quantity: 50,
  unit: "g",
  level: null,
  food_ref_id: 40,
  restock_threshold: 100,
  low_stock: true,
});
const soy = row({
  id: 8,
  name: "Sauce soja",
  category: "sauces",
  location: "frigo",
  level: "presque_vide",
  food_ref_id: 41,
});

describe("acceptScan", () => {
  it("ignore le même code tant qu'il reste devant l'objectif", () => {
    const seen = new Map<string, number>();
    expect(acceptScan("a", 0, seen)).toBe(true);
    expect(acceptScan("a", 400, seen)).toBe(false);
    expect(acceptScan("a", 2000, seen)).toBe(false); // le délai repart à chaque lecture
    expect(acceptScan("b", 2100, seen)).toBe(true);
    expect(acceptScan("a", 2000 + RESCAN_DELAY_MS, seen)).toBe(true);
  });
});

describe("lineFromProduct", () => {
  it("nouveau produit : contenance proposée, catégorie à choisir", () => {
    expect(lineFromProduct(nutella, [])).toMatchObject({
      key: nutella.code,
      name: "Nutella",
      existing: null,
      category: null,
      location: null,
      quantity: "400",
      unit: "g",
    });
    expect(lineFromProduct(eggs, [])).toMatchObject({ quantity: "", unit: "g" });
  });

  it("article en stock lié au même aliment : réapprovisionné, emplacement et catégorie repris", () => {
    const line = lineFromProduct(nutella, [soy, spread]);
    expect(line).toMatchObject({
      existing: spread,
      category: "sauces",
      quantity: "400",
      unit: "g",
    });
    expect(locationOf(line)).toBe("placard");
  });

  it("article suivi en niveau : pas de quantité ; autre unité : quantité à taper", () => {
    expect(lineFromProduct(soySauce, [soy])).toMatchObject({ existing: soy, quantity: "" });
    const byPiece = row({ id: 9, quantity: 2, unit: "piece", level: null, food_ref_id: 40 });
    expect(lineFromProduct(nutella, [byPiece])).toMatchObject({ quantity: "", unit: "piece" });
  });
});

describe("rescanned", () => {
  it("compte un emballage de plus et suit la quantité proposée", () => {
    const twice = rescanned(lineFromProduct(nutella, []));
    expect(twice).toMatchObject({ count: 2, quantity: "800" });
    expect(rescanned(twice)).toMatchObject({ count: 3, quantity: "1200" });
  });

  it("garde une quantité retouchée à la main", () => {
    const edited = { ...lineFromProduct(nutella, []), quantity: "350" };
    expect(rescanned(edited)).toMatchObject({ count: 2, quantity: "350" });
  });
});

describe("locationOf", () => {
  it("prend l'emplacement choisi, sinon celui de la catégorie", () => {
    const line = lineFromProduct(nutella, []);
    expect(locationOf(line)).toBeNull();
    expect(locationOf({ ...line, category: "frais" })).toBe("frigo");
    expect(locationOf({ ...line, category: "frais", location: "congelateur" })).toBe("congelateur");
  });
});

describe("purchasesOf", () => {
  it("construit tous les achats pour un seul appel", () => {
    const lines = [
      lineFromProduct(nutella, [spread]),
      lineFromProduct(soySauce, [soy]),
      {
        ...lineFromProduct(eggs, []),
        category: "frais" as const,
        quantity: "6",
        unit: "piece" as const,
      },
      {
        ...manualLine(" Pommes ", "m1"),
        category: "frais" as const,
        quantity: "1,2",
        unit: "kg" as const,
      },
    ];
    expect(purchasesOf(lines)).toEqual({
      ok: true,
      value: [
        { name: "Pâte à tartiner", category: "sauces", item_id: 7, quantity: 400, unit: "g" },
        { name: "Sauce soja", category: "sauces", item_id: 8 },
        { name: "Œufs bio", category: "frais", food_ref_id: 42, quantity: 6, unit: "piece" },
        { name: "Pommes", category: "frais", quantity: 1.2, unit: "kg" },
      ],
    });
  });

  it("joint la précision choisie après une ambiguïté", () => {
    const line = {
      ...manualLine("Pommes", "m1"),
      category: "frais" as const,
      choice: { food_ref_id: 12 },
    };
    expect(purchasesOf([line])).toEqual({
      ok: true,
      value: [{ name: "Pommes", category: "frais", food_ref_id: 12 }],
    });
  });

  it("dit ce qui manque, ligne par ligne", () => {
    expect(purchasesOf([])).toMatchObject({ ok: false });
    expect(purchasesOf([lineFromProduct(nutella, [])])).toEqual({
      ok: false,
      message: "« Nutella » : choisis une catégorie.",
    });
    expect(purchasesOf([{ ...lineFromProduct(nutella, [spread]), quantity: "" }])).toEqual({
      ok: false,
      message: "« Nutella » est suivi en quantité : indique combien tu en as acheté.",
    });
    expect(
      purchasesOf([
        { ...lineFromProduct(nutella, []), category: "sauces" as const, quantity: "beaucoup" },
      ]),
    ).toEqual({ ok: false, message: "« Nutella » : la quantité doit être un nombre positif." });
  });
});

describe("après l'envoi", () => {
  const item = (id: number, name: string, low?: true) => ({
    id,
    name,
    category: "sauces" as const,
    location: "placard" as const,
    ...(low ? { low_stock: low } : {}),
  });
  const result: AddItemsResult = {
    created: [item(20, "Œufs bio")],
    restocked: [item(7, "Pâte à tartiner"), item(8, "Sauce soja", true)],
    ambiguous: [
      {
        index: 2,
        name: "Pommes",
        reason: "food",
        hint: "",
        candidates: [{ food_ref_id: 12, name: "Pomme, crue" }],
        items: [],
      },
    ],
  };

  it("garde seulement les lignes ambiguës, retrouvées par leur position", () => {
    // Deux lignes portent le même nom : seule la seconde est ambiguë.
    const lines = [
      lineFromProduct(nutella, [spread]),
      { ...manualLine("Pommes", "m1"), category: "frais" as const },
      { ...manualLine("Pommes", "m2"), category: "frais" as const },
    ];
    const remaining = remainingLines(lines, result);
    expect(remaining.map((line) => line.key)).toEqual(["m2"]);
    expect(remaining[0]?.ambiguity?.candidates).toHaveLength(1);
    expect(remainingLines(lines, { ...result, ambiguous: [] })).toEqual([]);
  });

  it("résume ce qui est rangé et ce qui sort de la liste « À racheter »", () => {
    const before = [spread, { ...soy, low_stock: true }];
    const summary = summaryOf(result, before);
    expect(summary).toEqual({
      created: ["Œufs bio"],
      restocked: ["Pâte à tartiner", "Sauce soja"],
      noLongerToRestock: ["Pâte à tartiner"], // la sauce soja reste sous son seuil
    });
    expect(
      mergeSummaries(summary, { created: ["Pommes"], restocked: [], noLongerToRestock: [] })
        .created,
    ).toEqual(["Œufs bio", "Pommes"]);
    expect(mergeSummaries(null, summary)).toBe(summary);
  });
});
