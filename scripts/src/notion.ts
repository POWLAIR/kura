import type { InventoryCategory, InventoryLocation, QuantityUnit, StockLevel } from "@kura/core";
import { z } from "zod";
import { fold } from "./text";

// Lecture de la page Notion « Inventaire des ingrédients » : des titres de section
// suivis de listes à puces, une puce par article. Règles documentées dans docs/notion.md.

type Category = z.infer<typeof InventoryCategory>;
type Location = z.infer<typeof InventoryLocation>;
type Unit = z.infer<typeof QuantityUnit>;
type Level = z.infer<typeof StockLevel>;

// Sous-ensemble de la réponse GET /v1/blocks/{id}/children utilisé ici.
export const NotionBlock = z.looseObject({
  id: z.string(),
  type: z.string(),
  has_children: z.boolean(),
});
export type NotionBlock = z.infer<typeof NotionBlock>;

export const NotionBlockList = z.object({
  results: z.array(NotionBlock),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

const RichText = z.object({ rich_text: z.array(z.object({ plain_text: z.string() })) });

const HEADINGS = new Set(["heading_1", "heading_2", "heading_3"]);
const LIST_ITEMS = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);
// Texte libre sans article (intro, « À compléter… ») : ignoré. Tout autre bloc arrête l'import.
const IGNORED = new Set(["paragraph", "divider", "quote", "callout"]);

type Section = { category: Category; location: Location };

// Mot-clé du titre (sans accents) → catégorie et emplacement par défaut.
const SECTIONS: [RegExp, Section | "skip"][] = [
  [/\ba racheter\b/, "skip"], // liste de courses : articles absents du stock
  [/\b(epice|herbe)/, { category: "epices", location: "placard" }],
  [/\bfeculent/, { category: "feculents", location: "placard" }],
  [/\b(sauce|condiment)/, { category: "sauces", location: "placard" }],
  [/\bfait maison\b/, { category: "fait_maison", location: "frigo" }],
  [/\b(frigo|congel|frais)/, { category: "frais", location: "frigo" }],
];

// Indications entre parenthèses en fin d'article, comparées sans accents.
const LOCATION_HINTS: Record<string, Location> = {
  placard: "placard",
  frigo: "frigo",
  refrigerateur: "frigo",
  congelateur: "congelateur",
  congele: "congelateur",
  surgele: "congelateur",
};
const LEVEL_HINTS: Record<string, Level> = {
  plein: "plein",
  "grande quantite": "plein",
  plusieurs: "plein",
  moitie: "moitie",
  "a moitie": "moitie",
  "presque vide": "presque_vide",
  "bientot fini": "presque_vide",
};
const COUNT_HINTS: Record<string, number> = {
  douzaine: 12,
  "une douzaine": 12,
  "demi douzaine": 6,
  "une demi douzaine": 6,
};
const UNIT_HINTS: Record<string, [Unit, number]> = {
  g: ["g", 1],
  kg: ["g", 1000],
  ml: ["ml", 1],
  cl: ["ml", 10],
  l: ["ml", 1000],
};

type Amount =
  | { quantity: number; unit: Unit; level: null }
  | { quantity: null; unit: null; level: Level };

// Sans indication de quantité dans la page : niveau « plein » supposé.
const ASSUMED_AMOUNT: Amount = { quantity: null, unit: null, level: "plein" };

type ItemFields = {
  name: string;
  category: Category;
  location: Location;
  assumedLevel: boolean;
} & Amount;

export type InventoryDraft = { section: string } & ItemFields;

export function notionPageId(input: string): string {
  const path = (input.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  const id = /([0-9a-f]{32})$/i.exec(path.replace(/-/g, ""))?.[1];
  if (!id) throw new Error(`Identifiant de page Notion introuvable dans « ${input} »`);
  return id.toLowerCase();
}

export function sectionFor(heading: string): Section | "skip" {
  const key = fold(heading);
  const found = SECTIONS.find(([pattern]) => pattern.test(key));
  if (!found) throw new Error(`Section Notion inconnue : « ${heading} » (voir docs/notion.md)`);
  return found[1];
}

function amountHint(part: string): Amount | null {
  const key = fold(part);
  const level = LEVEL_HINTS[key];
  if (level) return { quantity: null, unit: null, level };
  const count = COUNT_HINTS[key];
  if (count) return { quantity: count, unit: "piece", level: null };

  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)?$/i.exec(part);
  if (!m?.[1]) return null;
  const unit = m[2] ? UNIT_HINTS[m[2].toLowerCase()] : (["piece", 1] as const);
  if (!unit) return null;
  const quantity = Number(m[1].replace(",", ".")) * unit[1];
  if (quantity === 0) throw new Error(`Quantité nulle : « ${part} »`);
  return { quantity, unit: unit[0], level: null };
}

// « Patates douces (2, congélateur) » → 2 pièces au congélateur.
// Une indication inconnue (« feuilles sèches ») reste dans le nom.
export function parseItem(text: string, section: Section): ItemFields {
  const m = /^(.*?)\s*\(([^()]*)\)$/.exec(text);
  const base = (m ? m[1] : text)?.trim();
  if (!base) throw new Error(`Article sans nom : « ${text} »`);

  let location: Location | null = null;
  let amount: Amount | null = null;
  const kept: string[] = [];
  // Virgule décimale (« 1,5 kg ») : on ne coupe que sur une virgule suivie d'autre chose qu'un chiffre.
  for (const part of (m?.[2] ?? "").split(/,(?!\d)/).map((p) => p.trim())) {
    if (!part) continue;
    const place = LOCATION_HINTS[fold(part)];
    const hint = place ? null : amountHint(part);
    if (place) {
      if (location) throw new Error(`Deux emplacements pour « ${text} »`);
      location = place;
    } else if (hint) {
      if (amount) throw new Error(`Deux quantités pour « ${text} »`);
      amount = hint;
    } else {
      kept.push(part);
    }
  }

  return {
    name: kept.length > 0 ? `${base} (${kept.join(", ")})` : base,
    category: section.category,
    location: location ?? section.location,
    assumedLevel: amount === null,
    ...(amount ?? ASSUMED_AMOUNT),
  };
}

function blockText(block: NotionBlock): string {
  const content = RichText.safeParse(block[block.type]);
  if (!content.success) throw new Error(`Bloc ${block.id} (${block.type}) : texte illisible`);
  return content.data.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

export function parseInventoryBlocks(blocks: NotionBlock[]): {
  items: InventoryDraft[];
  skipped: string[];
} {
  const items: InventoryDraft[] = [];
  const skipped: string[] = [];
  let section: { heading: string; def: Section | "skip" } | null = null;

  for (const block of blocks) {
    if (block.has_children) {
      throw new Error(
        `Bloc imbriqué non pris en charge (${block.type}) : aplatir la liste dans Notion`,
      );
    }
    if (HEADINGS.has(block.type)) {
      const heading = blockText(block).replace(/^[^\p{L}\p{N}]+/u, "");
      section = { heading, def: sectionFor(heading) };
    } else if (LIST_ITEMS.has(block.type)) {
      const text = blockText(block);
      if (!text) continue;
      if (!section) throw new Error(`Article « ${text} » placé avant le premier titre de section`);
      if (section.def === "skip") skipped.push(text);
      else items.push({ section: section.heading, ...parseItem(text, section.def) });
    } else if (!IGNORED.has(block.type)) {
      throw new Error(`Bloc Notion non pris en charge : ${block.type}`);
    }
  }
  return { items, skipped };
}
