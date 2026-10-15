import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type NotionBlock,
  NotionBlockList,
  notionPageId,
  parseInventoryBlocks,
  parseItem,
  sectionFor,
} from "../src/notion";

const fixture = NotionBlockList.parse(
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/notion/blocks.json"), "utf8")),
);

const bullet = (text: string, extra: Partial<NotionBlock> = {}): NotionBlock => ({
  id: text,
  type: "bulleted_list_item",
  has_children: false,
  bulleted_list_item: { rich_text: [{ plain_text: text }] },
  ...extra,
});
const heading = (text: string): NotionBlock => ({
  id: text,
  type: "heading_2",
  has_children: false,
  heading_2: { rich_text: [{ plain_text: text }] },
});

describe("notionPageId", () => {
  it.each([
    [
      "https://app.notion.com/p/Inventaire-des-ingr-dients-3f8a7a154ac181b3ab48c1689d0ea415?source=copy_link",
    ],
    ["https://www.notion.so/3f8a7a154ac181b3ab48c1689d0ea415/"],
    ["3f8a7a15-4ac1-81b3-ab48-c1689d0ea415"],
  ])("extrait l'id de %s", (input) => {
    expect(notionPageId(input)).toBe("3f8a7a154ac181b3ab48c1689d0ea415");
  });

  it("refuse un lien sans id", () => {
    expect(() => notionPageId("https://app.notion.com/p/Inventaire")).toThrow(/introuvable/);
  });
});

describe("sectionFor", () => {
  it.each([
    ["Épices et herbes", { category: "epices", location: "placard" }],
    ["Féculents et bases", { category: "feculents", location: "placard" }],
    ["Sauces et condiments", { category: "sauces", location: "placard" }],
    ["Frigo et congélateur", { category: "frais", location: "frigo" }],
    ["Fait maison", { category: "fait_maison", location: "frigo" }],
    ["À racheter", "skip"],
  ])("« %s »", (title, expected) => {
    expect(sectionFor(title)).toEqual(expected);
  });

  it("refuse une section inconnue plutôt que de deviner la catégorie", () => {
    expect(() => sectionFor("Cave à vin")).toThrow(/Section Notion inconnue/);
  });
});

describe("parseItem", () => {
  const placard = { category: "sauces", location: "placard" } as const;
  const frais = { category: "frais", location: "frigo" } as const;

  it.each([
    ["Thym", placard, { name: "Thym", location: "placard", level: "plein", assumedLevel: true }],
    [
      "Riz long (grande quantité)",
      placard,
      { name: "Riz long", level: "plein", assumedLevel: false },
    ],
    ["Sauces pimentées (plusieurs)", frais, { name: "Sauces pimentées", level: "plein" }],
    ["Moutarde (moitié)", placard, { level: "moitie", quantity: null, unit: null }],
    ["Pomme de terre (1)", frais, { name: "Pomme de terre", quantity: 1, unit: "piece" }],
    ["Œufs (une douzaine)", frais, { name: "Œufs", quantity: 12, unit: "piece", level: null }],
    [
      "Patates douces (2, congélateur)",
      frais,
      { name: "Patates douces", quantity: 2, unit: "piece", location: "congelateur" },
    ],
    [
      "Pâtes fraîches (congélateur)",
      frais,
      { location: "congelateur", level: "plein", assumedLevel: true },
    ],
    ["Farine (1,5 kg)", placard, { name: "Farine", quantity: 1500, unit: "g" }],
    ["Lait (50 cl, frigo)", placard, { quantity: 500, unit: "ml", location: "frigo" }],
    [
      "Lasagnes (feuilles sèches)",
      placard,
      { name: "Lasagnes (feuilles sèches)", level: "plein", assumedLevel: true },
    ],
    [
      "Tomates (cerises, 3, frigo)",
      placard,
      { name: "Tomates (cerises)", quantity: 3, location: "frigo" },
    ],
  ] as const)("« %s »", (text, section, expected) => {
    expect(parseItem(text, section)).toMatchObject({ category: section.category, ...expected });
  });

  it.each([
    ["Riz (2, moitié)", /Deux quantités/],
    ["Riz (frigo, placard)", /Deux emplacements/],
    ["(frigo)", /sans nom/],
    ["Riz (0)", /Quantité nulle/],
  ])("refuse « %s »", (text, error) => {
    expect(() => parseItem(text, placard)).toThrow(error);
  });
});

describe("parseInventoryBlocks", () => {
  const { items, skipped } = parseInventoryBlocks(fixture.results);

  it("lit chaque puce sous sa section et ignore le texte libre et les puces vides", () => {
    expect(items.map((i) => [i.section, i.name])).toEqual([
      ["Épices et herbes", "Thym"],
      ["Épices et herbes", "Clous de girofle"],
      ["Féculents et bases", "Riz long"],
      ["Féculents et bases", "Lasagnes (feuilles sèches)"],
      ["Sauces et condiments", "Moutarde"],
      ["Sauces et condiments", "Sauce soja"],
      ["Frigo et congélateur", "Pomme de terre"],
      ["Frigo et congélateur", "Œufs"],
      ["Frigo et congélateur", "Patates douces"],
      ["Fait maison", "Ratatouille en bocal"],
    ]);
  });

  it("met de côté la liste « À racheter » : ces articles ne sont pas en stock", () => {
    expect(skipped).toEqual(["Farine"]);
  });

  it("refuse une liste imbriquée, un bloc inconnu ou une puce hors section", () => {
    expect(() =>
      parseInventoryBlocks([heading("Sauces"), bullet("Sauce soja", { has_children: true })]),
    ).toThrow(/imbriqué/);
    expect(() =>
      parseInventoryBlocks([heading("Sauces"), { id: "t", type: "table", has_children: false }]),
    ).toThrow(/non pris en charge : table/);
    expect(() => parseInventoryBlocks([bullet("Sel")])).toThrow(/avant le premier titre/);
  });
});
