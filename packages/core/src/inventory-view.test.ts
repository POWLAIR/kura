import { describe, expect, it } from "vitest";
import {
  expiryLabel,
  expiryStatus,
  formatAmount,
  formatDateInput,
  groupInventory,
  parseDateInput,
} from "./inventory-view.ts";

const TODAY = "2026-11-12";

describe("formatAmount", () => {
  it("écrit la quantité avec son unité, en kg ou en l à partir de 1000", () => {
    expect(formatAmount({ quantity: 250, unit: "g" })).toBe("250 g");
    expect(formatAmount({ quantity: 1500, unit: "g" })).toBe("1,5 kg");
    expect(formatAmount({ quantity: 1000, unit: "ml" })).toBe("1 l");
    expect(formatAmount({ quantity: 0, unit: "ml" })).toBe("0 ml");
  });

  it("accorde les pièces", () => {
    expect(formatAmount({ quantity: 1, unit: "piece" })).toBe("1 pièce");
    expect(formatAmount({ quantity: 6, unit: "piece" })).toBe("6 pièces");
  });

  it("donne le niveau d'un article suivi en niveau", () => {
    expect(formatAmount({ level: "moitie" })).toBe("Moitié");
    expect(formatAmount({ level: "presque_vide", quantity: null, unit: null })).toBe(
      "Presque vide",
    );
  });
});

describe("expiryStatus et expiryLabel", () => {
  it("distingue périmé, proche et plus tard", () => {
    expect(expiryStatus(null, TODAY)).toEqual({ kind: "none" });
    expect(expiryStatus("2026-11-10", TODAY)).toEqual({ kind: "expired", days: 2 });
    expect(expiryStatus(TODAY, TODAY)).toEqual({ kind: "soon", days: 0 });
    expect(expiryStatus("2026-11-15", TODAY)).toEqual({ kind: "soon", days: 3 });
    expect(expiryStatus("2026-11-16", TODAY)).toEqual({ kind: "later", days: 4 });
  });

  it("compte les jours à travers un changement d'heure", () => {
    expect(expiryStatus("2026-10-26", "2026-10-24")).toEqual({ kind: "soon", days: 2 });
    expect(expiryStatus("2027-03-29", "2027-03-27")).toEqual({ kind: "soon", days: 2 });
  });

  it("écrit un libellé neutre", () => {
    expect(expiryLabel(undefined, TODAY)).toBeNull();
    expect(expiryLabel("2026-11-11", TODAY)).toBe("Périmé depuis hier");
    expect(expiryLabel("2026-11-02", TODAY)).toBe("Périmé depuis 10 jours");
    expect(expiryLabel(TODAY, TODAY)).toBe("Périme aujourd'hui");
    expect(expiryLabel("2026-11-13", TODAY)).toBe("Périme demain");
    expect(expiryLabel("2026-11-14", TODAY)).toBe("Périme dans 2 jours");
    expect(expiryLabel("2026-12-24", TODAY)).toBe("Jusqu'au 24 décembre");
  });
});

describe("parseDateInput", () => {
  it("lit une date française ou ISO", () => {
    expect(parseDateInput("24/12/2026", TODAY)).toBe("2026-12-24");
    expect(parseDateInput(" 3/1/27 ", TODAY)).toBe("2027-01-03");
    expect(parseDateInput("24.12.2026", TODAY)).toBe("2026-12-24");
    expect(parseDateInput("2026-12-24", TODAY)).toBe("2026-12-24");
  });

  it("sans année, prend la prochaine occurrence", () => {
    expect(parseDateInput("24/12", TODAY)).toBe("2026-12-24");
    expect(parseDateInput("12/11", TODAY)).toBe(TODAY);
    expect(parseDateInput("5/1", TODAY)).toBe("2027-01-05");
  });

  it("sans année, une date passée depuis peu reste dans l'année en cours", () => {
    expect(parseDateInput("10/11", TODAY)).toBe("2026-11-10");
    expect(parseDateInput("13/10", TODAY)).toBe("2026-10-13"); // il y a 30 jours
    expect(parseDateInput("12/10", TODAY)).toBe("2027-10-12"); // il y a 31 jours
    expect(parseDateInput("28/12", "2027-01-03")).toBe("2026-12-28"); // à cheval sur deux années
    expect(expiryLabel(parseDateInput("10/11", TODAY), TODAY)).toBe("Périmé depuis 2 jours");
  });

  it("sans année, un 29 février est le prochain qui existe", () => {
    expect(parseDateInput("29/02", TODAY)).toBe("2028-02-29");
    expect(parseDateInput("29/02", "2028-03-05")).toBe("2028-02-29"); // passé de peu
    expect(parseDateInput("29/02/2027", TODAY)).toBeNull();
  });

  it("pour le journal, sans année c'est la dernière fois que cette date est arrivée", () => {
    const past = { past: true };
    expect(parseDateInput("12/11", TODAY, past)).toBe(TODAY);
    expect(parseDateInput("5/10", TODAY, past)).toBe("2026-10-05");
    expect(parseDateInput("24/12", TODAY, past)).toBe("2025-12-24");
    expect(parseDateInput("29/02", TODAY, past)).toBe("2024-02-29");
    expect(parseDateInput("24/12/2026", TODAY, past)).toBe("2026-12-24"); // année donnée : telle quelle
  });

  it("refuse ce qui n'est pas une date", () => {
    for (const input of ["", "demain", "31/02/2027", "12/13", "2026-13-01", "1/2/3/4"]) {
      expect(parseDateInput(input, TODAY), input).toBeNull();
    }
  });

  it("préremplit un champ au format français", () => {
    expect(formatDateInput("2026-12-24")).toBe("24/12/2026");
    expect(formatDateInput(null)).toBe("");
    expect(parseDateInput(formatDateInput("2026-12-24"), TODAY)).toBe("2026-12-24");
  });
});

describe("groupInventory", () => {
  const item = (
    name: string,
    location: "placard" | "frigo" | "congelateur",
    category: "epices" | "feculents" | "sauces" | "frais" | "fait_maison",
  ) => ({ name, location, category });

  it("regroupe par emplacement puis catégorie, dans l'ordre de la conception", () => {
    const groups = groupInventory([
      item("Œufs", "frigo", "frais"),
      item("riz", "placard", "feculents"),
      item("Cumin", "placard", "epices"),
      item("Pâtes", "placard", "feculents"),
      item("Épinards", "congelateur", "frais"),
      item("échalotes", "frigo", "frais"),
    ]);
    expect(
      groups.map((group) => [
        group.label,
        group.categories.map((c) => [c.label, c.items.map((i) => i.name)]),
      ]),
    ).toEqual([
      [
        "Placard",
        [
          ["Épices", ["Cumin"]],
          ["Féculents", ["Pâtes", "riz"]],
        ],
      ],
      ["Frigo", [["Frais", ["échalotes", "Œufs"]]]],
      ["Congélateur", [["Frais", ["Épinards"]]]],
    ]);
  });

  it("omet les emplacements vides", () => {
    expect(groupInventory([])).toEqual([]);
    expect(groupInventory([item("Sel", "placard", "epices")]).map((g) => g.location)).toEqual([
      "placard",
    ]);
  });
});
