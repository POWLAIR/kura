import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MICRONUTRIENTS, NUTRIENT_DETAILS } from "@kura/core";
import { describe, expect, it } from "vitest";
import {
  checkConstituents,
  DETAIL_CONSTITUENTS,
  MICRO_CONSTITUENTS,
  parseCiqual,
  parseCiqualValue,
} from "../src/ciqual";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures/ciqual", `${name}_2025_11_03.xml`), "utf8");

const files = { alim: fixture("alim"), const: fixture("const"), compo: fixture("compo") };

describe("parseCiqualValue", () => {
  it.each([
    ["155", 155],
    ["3,31", 3.31],
    [" 0,045 ", 0.045],
    ["0", 0],
  ])("« %s » → %s", (raw, expected) => {
    expect(parseCiqualValue(raw)).toBe(expected);
  });

  it.each(["-", "traces", "Traces", "< 0,05", "<0,5", "", undefined])(
    "« %s » → null (non renseignée, jamais 0)",
    (raw) => {
      expect(parseCiqualValue(raw)).toBeNull();
    },
  );

  it("refuse un format inconnu plutôt que de deviner", () => {
    expect(() => parseCiqualValue("1.5e3")).toThrow(/format inconnu/);
    expect(() => parseCiqualValue("environ 3")).toThrow(/format inconnu/);
  });
});

describe("parseCiqual", () => {
  const rows = parseCiqual(files);
  const byCode = new Map(rows.map((r) => [r.code, r]));

  it("lit tous les aliments, même sans composition utilisable", () => {
    expect(rows.map((r) => r.code)).toEqual(["9104", "2028", "9107"]);
    expect(rows.every((r) => r.source === "ciqual")).toBe(true);
  });

  it("décode les entités XML des noms", () => {
    expect(byCode.get("2028")?.name).toBe("Jus d'orange, frais");
  });

  it("remplit les colonnes principales, protéines en N x 6.25", () => {
    expect(byCode.get("9104")).toMatchObject({
      name: "Riz blanc, cuit, sans sel ajouté",
      energy_kcal: 155,
      protein_g: 3.31,
      carbs_g: 33.2,
      fat_g: 0.7,
      fiber_g: 1.1,
      salt_g: 0.045,
    });
  });

  it("laisse null les valeurs traces, sous le seuil ou non mesurées", () => {
    const riz = byCode.get("9104");
    expect(riz?.sugars_g).toBeNull(); // traces
    expect(riz?.saturated_fat_g).toBeNull(); // < 0,05
    expect(byCode.get("9107")?.energy_kcal).toBeNull(); // -
  });

  it("range vitamines et minéraux sous des clés stables, sans clé pour les valeurs absentes", () => {
    expect(byCode.get("9104")?.micronutrients).toEqual({ iron_mg: 0.2 });
    expect(byCode.get("2028")?.micronutrients).toEqual({ vitamin_c_mg: 41.3, vitamin_b9_ug: 30 });
    expect(byCode.get("9107")?.micronutrients).toEqual({});
  });

  it("range le détail des glucides et lipides, l'eau et l'alcool à part des micronutriments", () => {
    expect(byCode.get("9104")?.nutrient_details).toEqual({ starch_g: 30.5, water_g: 63.6 });
    expect(byCode.get("2028")?.nutrient_details).toEqual({});
  });

  it("ignore les constituants non retenus (protéines Jones, cendres) : aucun autre champ", () => {
    expect(Object.keys(byCode.get("9104") ?? {}).sort()).toEqual(
      [
        "source",
        "code",
        "name",
        "energy_kcal",
        "protein_g",
        "carbs_g",
        "sugars_g",
        "fat_g",
        "saturated_fat_g",
        "fiber_g",
        "salt_g",
        "micronutrients",
        "nutrient_details",
      ].sort(),
    );
  });

  it("refuse une composition qui référence un aliment inconnu", () => {
    const compo = files.compo.replace(
      "<alim_code> 9107 </alim_code>",
      "<alim_code> 1 </alim_code>",
    );
    expect(() => parseCiqual({ ...files, compo })).toThrow(/Aliment 1/);
  });
});

describe("checkConstituents", () => {
  it("accepte la liste officielle Ciqual 2025", () => {
    expect(() => checkConstituents(files.const)).not.toThrow();
  });

  it("détecte un constituant renuméroté ou d'unité différente", () => {
    const renamed = files.const.replace("Fer (mg/100 g)", "Fer (µg/100 g)");
    expect(() => checkConstituents(renamed)).toThrow(/10260/);
    const removed = files.const.replace(
      "<const_code> 55100 </const_code>",
      "<const_code> 1 </const_code>",
    );
    expect(() => checkConstituents(removed)).toThrow(/55100 absent/);
  });

  it.each([
    ["micronutrients", MICRO_CONSTITUENTS, MICRONUTRIENTS],
    ["nutrient_details", DETAIL_CONSTITUENTS, NUTRIENT_DETAILS],
  ] as const)("couvre toutes les clés %s de @kura/core", (_, mapping, defs) => {
    const mapped = Object.values(mapping)
      .map((m) => m.key)
      .sort();
    expect(mapped).toEqual(defs.map((d) => d.key).sort());
  });
});
