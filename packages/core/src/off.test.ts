import { describe, expect, it } from "vitest";
import { MICRONUTRIENTS, NUTRIENT_DETAILS } from "./nutrients.ts";
import {
  Ean,
  mapOffProduct,
  OFF_DETAILS,
  OFF_MAIN,
  OFF_MICRONUTRIENTS,
  offProductUrl,
} from "./off.ts";

const NUTELLA = "3017620422003";

// Réponse réelle d'Open Food Facts, réduite aux champs demandés (relevée le 2026-11-10).
const nutella = {
  code: NUTELLA,
  status: 1,
  status_verbose: "product found",
  product: {
    code: NUTELLA,
    brands: "Ferrero, Nutella",
    generic_name_fr: "Pâte à tartiner aux noisettes et au cacao",
    product_name: "Nutella",
    product_name_fr: "Nutella",
    product_quantity: 400,
    product_quantity_unit: "g",
    nutriments_estimated: { calcium_100g: 0.002821743, sucrose_100g: 76.31706 },
    nutriments: {
      "energy-kcal_100g": 539,
      "energy-kj_100g": 2252,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      sugars_100g: 56.3,
      fat_100g: 30.9,
      "saturated-fat_100g": 10.6,
      fiber_100g: 0,
      salt_100g: 0.107,
      sodium_100g: 0.0428,
      "nova-group_100g": 4,
      "fruits-vegetables-nuts-estimate-from-ingredients_100g": 0,
    },
  },
};

describe("Ean", () => {
  it("accepte EAN-13, EAN-8 et GTIN-14 avec une clé de contrôle juste", () => {
    for (const code of [NUTELLA, "96385074", "10614141000415"]) {
      expect(Ean.parse(code)).toBe(code);
    }
    expect(Ean.parse(` ${NUTELLA} `)).toBe(NUTELLA);
  });

  it("complète un UPC-A en EAN-13", () => {
    expect(Ean.parse("036000291452")).toBe("0036000291452");
  });

  it("refuse une longueur ou une clé de contrôle incorrecte, et tout ce qui n'est pas un chiffre", () => {
    for (const code of ["3017620422004", "123", "30176204220031", "30176A0422003", ""]) {
      expect(Ean.safeParse(code).success).toBe(false);
    }
  });
});

describe("offProductUrl", () => {
  it("ne contient que le code-barres et la liste des champs", () => {
    const url = new URL(offProductUrl(Ean.parse(NUTELLA)));
    expect(url.origin + url.pathname).toBe(
      `https://world.openfoodfacts.org/api/v2/product/${NUTELLA}`,
    );
    expect([...url.searchParams.keys()]).toEqual(["fields"]);
    expect(url.searchParams.get("fields")).not.toContain("nutriments_estimated");
  });
});

describe("mapOffProduct", () => {
  it("reprend les valeurs déclarées pour 100 g", () => {
    expect(mapOffProduct(NUTELLA, nutella)).toEqual({
      code: NUTELLA,
      name: "Nutella",
      brand: "Ferrero, Nutella",
      package_quantity: 400,
      package_unit: "g",
      per_100_unit: "g",
      energy_kcal: 539,
      protein_g: 6.3,
      carbs_g: 57.5,
      sugars_g: 56.3,
      fat_g: 30.9,
      saturated_fat_g: 10.6,
      fiber_g: 0,
      salt_g: 0.107,
      micronutrients: {},
      nutrient_details: {},
    });
  });

  it("ignore les valeurs estimées par OFF depuis les ingrédients", () => {
    const food = mapOffProduct(NUTELLA, nutella);
    expect(food?.micronutrients).not.toHaveProperty("calcium_mg");
    expect(food?.nutrient_details).not.toHaveProperty("sucrose_g");
  });

  it("laisse null ou sans clé ce qui n'est pas renseigné, sans rien estimer", () => {
    const food = mapOffProduct(NUTELLA, {
      status: 1,
      product: {
        product_name: "Sauce soja",
        nutriments: { salt_100g: 16.9, "energy-kj_100g": 280 },
      },
    });
    expect(food).toMatchObject({
      name: "Sauce soja",
      brand: null,
      package_quantity: null,
      package_unit: null,
      energy_kcal: null, // les kJ ne sont pas convertis
      protein_g: null,
      salt_g: 16.9,
      micronutrients: {},
    });
  });

  it("convertit les vitamines et minéraux, exprimés en grammes chez OFF", () => {
    const food = mapOffProduct(NUTELLA, {
      status: 1,
      product: {
        product_name: "Lait",
        product_quantity: "1000",
        product_quantity_unit: "ml",
        nutriments: {
          calcium_100g: 0.12,
          "vitamin-d_100g": 7.5e-7,
          "vitamin-b12_100g": "0.0000004",
          cholesterol_100g: 0.014,
          "monounsaturated-fat_100g": 0.4,
          alcohol_100g: 0,
          "vitamin-k_100g": 0.00001,
          iron_100g: -1,
          zinc_100g: "n/a",
        },
      },
    });
    expect(food?.micronutrients).toEqual({
      calcium_mg: 120,
      vitamin_d_ug: 0.75,
      vitamin_b12_ug: 0.4,
    });
    expect(food?.nutrient_details).toEqual({ cholesterol_mg: 14, monounsaturated_fat_g: 0.4 });
    expect(food).toMatchObject({ package_quantity: 1000, package_unit: "ml", per_100_unit: "ml" });
  });

  it("ne garde la contenance que si elle est en g ou en ml", () => {
    const food = mapOffProduct(NUTELLA, {
      status: 1,
      product: { product_name: "Œufs", product_quantity: 6, product_quantity_unit: "pcs" },
    });
    expect(food).toMatchObject({ package_quantity: null, package_unit: null, per_100_unit: "g" });
  });

  it("renvoie null pour un produit inconnu ou sans nom", () => {
    expect(mapOffProduct(NUTELLA, { code: NUTELLA, status: 0 })).toBeNull();
    expect(mapOffProduct(NUTELLA, { status: 1, product: { product_name: " " } })).toBeNull();
    expect(mapOffProduct(NUTELLA, null)).toBeNull();
    expect(mapOffProduct(NUTELLA, "erreur")).toBeNull();
  });
});

describe("tables de correspondance", () => {
  it("ne visent que des clés connues, chacune une seule fois", () => {
    const micro = Object.values(OFF_MICRONUTRIENTS).map((entry) => entry.key);
    const details = Object.values(OFF_DETAILS).map((entry) => entry.key);
    expect(new Set(micro).size).toBe(micro.length);
    expect(new Set(details).size).toBe(details.length);
    expect(MICRONUTRIENTS.map((n) => n.key)).toEqual(expect.arrayContaining(micro));
    expect(NUTRIENT_DETAILS.map((n) => n.key)).toEqual(expect.arrayContaining(details));
    expect(Object.values(OFF_MAIN)).toHaveLength(8);
  });

  it("applique le facteur de l'unité de la clé", () => {
    const factors = { g: 1, mg: 1_000, ug: 1_000_000 } as const;
    for (const { key, factor } of [
      ...Object.values(OFF_MICRONUTRIENTS),
      ...Object.values(OFF_DETAILS),
    ]) {
      const suffix = key.split("_").at(-1) as keyof typeof factors;
      expect(factor, key).toBe(factors[suffix]);
    }
  });
});
