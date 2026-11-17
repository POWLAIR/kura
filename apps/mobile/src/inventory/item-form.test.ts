import { describe, expect, it } from "vitest";
import { apiErrorFrom } from "../lib/api-error";
import { newIdempotencyKey } from "../lib/idempotency";
import {
  ambiguityMessage,
  changesOf,
  EMPTY_PURCHASE,
  formOf,
  type InventoryRow,
  parseQuantity,
  purchaseOf,
  stockUnitOf,
} from "./item-form";

const TODAY = "2026-11-12";

const rice: InventoryRow = {
  id: 1,
  name: "Riz long",
  category: "feculents",
  location: "placard",
  quantity: 750,
  unit: "g",
  level: null,
  expires_on: null,
  restock_threshold: 200,
  restock_level: null,
  food_ref_id: 12,
  food_name: "Riz blanc, cru",
  low_stock: false,
};

const soy: InventoryRow = {
  ...rice,
  id: 2,
  name: "Sauce soja",
  category: "sauces",
  quantity: null,
  unit: null,
  level: "moitie",
  restock_threshold: null,
  restock_level: "presque_vide",
  food_ref_id: null,
  food_name: null,
};

describe("parseQuantity", () => {
  it("accepte la virgule et le point", () => {
    expect(parseQuantity("1,5")).toBe(1.5);
    expect(parseQuantity(" 250 ")).toBe(250);
    expect(parseQuantity("0")).toBe(0);
  });

  it("refuse ce qui n'est pas un nombre positif", () => {
    for (const text of ["", "-1", "1,2,3", "un", "1e3", "1 kg"]) {
      expect(parseQuantity(text), text).toBeNull();
    }
  });
});

describe("purchaseOf", () => {
  it("construit un achat en quantité", () => {
    expect(
      purchaseOf(
        { ...EMPTY_PURCHASE, name: " Riz ", category: "feculents", quantity: "1,5", unit: "kg" },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      value: { name: "Riz", category: "feculents", quantity: 1.5, unit: "kg" },
    });
  });

  it("sans quantité, l'article sera suivi en niveau ; emplacement et date sont optionnels", () => {
    expect(
      purchaseOf(
        {
          ...EMPTY_PURCHASE,
          name: "Cumin",
          category: "epices",
          location: "placard",
          expires: "24/12",
        },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      value: { name: "Cumin", category: "epices", location: "placard", expires_on: "2026-12-24" },
    });
  });

  it("joint la précision donnée après une ambiguïté", () => {
    const form = { ...EMPTY_PURCHASE, name: "Riz", category: "feculents" as const };
    expect(purchaseOf(form, TODAY, { food_ref_id: null })).toMatchObject({
      ok: true,
      value: { food_ref_id: null },
    });
    expect(purchaseOf(form, TODAY, { item_id: 7 })).toMatchObject({
      ok: true,
      value: { item_id: 7 },
    });
  });

  it("explique ce qui manque, en français", () => {
    expect(purchaseOf(EMPTY_PURCHASE, TODAY)).toEqual({
      ok: false,
      message: "Donne un nom à l'article.",
    });
    expect(purchaseOf({ ...EMPTY_PURCHASE, name: "Riz" }, TODAY)).toEqual({
      ok: false,
      message: "Choisis une catégorie.",
    });
    const form = { ...EMPTY_PURCHASE, name: "Riz", category: "feculents" as const };
    expect(purchaseOf({ ...form, quantity: "beaucoup" }, TODAY).ok).toBe(false);
    expect(purchaseOf({ ...form, quantity: "0" }, TODAY).ok).toBe(false);
    expect(purchaseOf({ ...form, expires: "bientôt" }, TODAY)).toEqual({
      ok: false,
      message: "Date : écris-la comme 24/12 ou 24/12/2026.",
    });
  });
});

describe("ambiguityMessage", () => {
  const ambiguity = { name: "Riz", hint: "", candidates: [], items: [] };

  it("dit qu'aucun aliment ne correspond quand il n'y a rien à proposer", () => {
    expect(ambiguityMessage({ ...ambiguity, reason: "food" })).toMatch(
      /^Aucun aliment de référence/,
    );
  });

  it("demande de choisir quand il y a des candidats ou des articles", () => {
    const candidates = [{ food_ref_id: 1, name: "Riz blanc, cru" }];
    expect(ambiguityMessage({ ...ambiguity, reason: "food", candidates })).toMatch(/Lequel est-ce/);
    expect(ambiguityMessage({ ...ambiguity, reason: "quantity_required" })).toMatch(/combien/);
  });
});

describe("changesOf", () => {
  it("ne renvoie rien quand rien n'a changé", () => {
    expect(changesOf(rice, formOf(rice), TODAY)).toEqual({ ok: true, value: null });
    expect(changesOf(soy, formOf(soy), TODAY)).toEqual({ ok: true, value: null });
  });

  it("n'envoie que les champs modifiés", () => {
    const form = {
      ...formOf(rice),
      quantity: "500",
      expires: "1/12/2026",
      location: "frigo" as const,
    };
    expect(changesOf(rice, form, TODAY)).toEqual({
      ok: true,
      value: { quantity: 500, unit: "g", expires_on: "2026-12-01", location: "frigo" },
    });
  });

  it("ne voit pas de changement entre 750 g et 0,75 kg", () => {
    expect(changesOf(rice, { ...formOf(rice), quantity: "0,75", unit: "kg" }, TODAY)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("efface une date, un seuil ou l'aliment de référence avec null", () => {
    const dated = { ...rice, expires_on: "2026-12-01" };
    const form = { ...formOf(dated), expires: "", restockThreshold: "", foodRefId: null };
    expect(changesOf(dated, form, TODAY)).toEqual({
      ok: true,
      value: { expires_on: null, restock_threshold: null, food_ref_id: null },
    });
  });

  it("passe de la quantité au niveau, avec son seuil en niveau", () => {
    const form = {
      ...formOf(rice),
      mode: "level" as const,
      level: "moitie" as const,
      restockLevel: "presque_vide" as const,
    };
    expect(changesOf(rice, form, TODAY)).toEqual({
      ok: true,
      value: { level: "moitie", restock_level: "presque_vide" },
    });
  });

  it("passe du niveau à la quantité : quantité, unité et seuil éventuel", () => {
    const form = {
      ...formOf(soy),
      mode: "quantity" as const,
      quantity: "150",
      unit: "ml" as const,
      restockThreshold: "30",
    };
    expect(stockUnitOf(form)).toBe("ml");
    expect(changesOf(soy, form, TODAY)).toEqual({
      ok: true,
      value: { quantity: 150, unit: "ml", restock_threshold: 30 },
    });
  });

  it("change d'unité : l'ancien seuil est effacé par le serveur, on ne le renvoie pas", () => {
    const form = { ...formOf(rice), quantity: "3", unit: "piece" as const, restockThreshold: "" };
    expect(changesOf(rice, form, TODAY)).toEqual({
      ok: true,
      value: { quantity: 3, unit: "piece" },
    });
  });

  it("corrige un niveau et retire son seuil", () => {
    const form = { ...formOf(soy), level: "presque_vide" as const, restockLevel: null };
    expect(changesOf(soy, form, TODAY)).toEqual({
      ok: true,
      value: { level: "presque_vide", restock_level: null },
    });
  });

  it("refuse un nom vide, une quantité ou un seuil illisibles, une date invalide", () => {
    expect(changesOf(rice, { ...formOf(rice), name: " " }, TODAY).ok).toBe(false);
    expect(changesOf(rice, { ...formOf(rice), quantity: "" }, TODAY).ok).toBe(false);
    expect(changesOf(rice, { ...formOf(rice), restockThreshold: "peu" }, TODAY).ok).toBe(false);
    expect(changesOf(rice, { ...formOf(rice), expires: "31/02" }, TODAY).ok).toBe(false);
  });
});

describe("apiErrorFrom", () => {
  it("reprend le code et le message d'une fonction", () => {
    const error = apiErrorFrom(422, {
      error: { code: "refused", message: "Article 7 introuvable" },
    });
    expect([error.code, error.message, error.status]).toEqual([
      "refused",
      "Article 7 introuvable",
      422,
    ]);
  });

  it("donne un message générique pour un corps inattendu", () => {
    for (const body of [null, "<html>", { message: "name resolution failed" }]) {
      const error = apiErrorFrom(503, body);
      expect(error.code).toBe("unexpected");
      expect(error.message).toMatch(/Réessaie/);
    }
  });
});

describe("newIdempotencyKey", () => {
  it("donne des clés distinctes, au format accepté par le serveur", () => {
    const keys = Array.from({ length: 50 }, () => newIdempotencyKey("courses"));
    expect(new Set(keys).size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^courses-[a-z0-9]+-[a-z0-9]{10}$/);
  });
});
