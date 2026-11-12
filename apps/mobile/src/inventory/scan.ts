import {
  type AddItemsResult,
  DEFAULT_LOCATION,
  type InventoryCategory,
  type InventoryLocation,
  type PurchaseAmbiguity,
  PurchaseItem,
  type PurchaseUnit,
} from "@kura/core";
import {
  type FormResult,
  type InventoryRow,
  type PurchaseChoice,
  parseQuantity,
} from "./item-form";

// Parcours « ranger les courses » : la liste temporaire des produits scannés ou tapés, puis
// son envoi en une fois à add_items. Sans React : testé avec Vitest.

// Produit renvoyé par la fonction off-product (ligne de food_ref).
export type ScannedFood = {
  id: number;
  code: string;
  name: string;
  brand: string | null;
  package_quantity: number | null;
  package_unit: "g" | "ml" | null;
};

export type ScanLine = {
  key: string; // code-barres, ou identifiant d'une ligne tapée
  food: ScannedFood | null; // null : produit sans code-barres, rapproché de Ciqual à l'envoi
  name: string;
  count: number; // nombre d'emballages scannés
  existing: InventoryRow | null; // article en stock lié au même aliment : il sera réapprovisionné
  category: InventoryCategory | null;
  location: InventoryLocation | null; // null : selon la catégorie
  quantity: string; // quantité totale achetée ; vide : suivi en niveau
  unit: PurchaseUnit;
  // Ambiguïté renvoyée par add_items pour cette ligne, et la précision choisie.
  ambiguity: PurchaseAmbiguity | null;
  choice: PurchaseChoice | null;
};

const fail = (message: string): FormResult<never> => ({ ok: false, message });

const amountText = (value: number) => String(value).replace(".", ",");

// Quantité proposée pour `count` emballages, ou vide si la contenance n'est pas connue.
function packageQuantity(food: ScannedFood, count: number): string {
  return food.package_quantity === null ? "" : amountText(food.package_quantity * count);
}

// Un même code relu par la caméra dans ce délai est le même passage devant l'objectif.
export const RESCAN_DELAY_MS = 2500;

// Vrai si ce code doit être pris en compte maintenant ; note l'instant de son passage.
export function acceptScan(code: string, now: number, seen: Map<string, number>): boolean {
  const last = seen.get(code);
  seen.set(code, now);
  return last === undefined || now - last >= RESCAN_DELAY_MS;
}

// Ligne d'un produit scanné. Un article en stock lié au même aliment sera réapprovisionné :
// son emplacement et sa catégorie sont repris. Sinon c'est un nouvel article, dont la
// catégorie reste à choisir.
export function lineFromProduct(food: ScannedFood, inventory: InventoryRow[]): ScanLine {
  const existing = inventory.find((item) => item.food_ref_id === food.id) ?? null;
  // Article suivi en niveau : il repasse à « plein », sans quantité.
  const byLevel = existing !== null && existing.level !== null;
  // Article suivi dans une autre unité que l'emballage : la quantité est à taper.
  const sameUnit = existing === null || existing.unit === food.package_unit;
  return {
    key: food.code,
    food,
    name: food.name,
    count: 1,
    existing,
    category: existing?.category ?? null,
    location: existing?.location ?? null,
    quantity: byLevel || !sameUnit ? "" : packageQuantity(food, 1),
    unit: existing?.unit ?? food.package_unit ?? "g",
    ambiguity: null,
    choice: null,
  };
}

// Le même produit scanné une fois de plus. La quantité suit, sauf si elle a été retouchée.
export function rescanned(line: ScanLine): ScanLine {
  const count = line.count + 1;
  const untouched = line.food !== null && line.quantity === packageQuantity(line.food, line.count);
  return {
    ...line,
    count,
    quantity: untouched && line.food ? packageQuantity(line.food, count) : line.quantity,
  };
}

// Produit sans code-barres (fruits, légumes), tapé ou dicté.
export function manualLine(name: string, key: string): ScanLine {
  return {
    key,
    food: null,
    name: name.trim(),
    count: 1,
    existing: null,
    category: null,
    location: null,
    quantity: "",
    unit: "g",
    ambiguity: null,
    choice: null,
  };
}

// Emplacement où l'article ira : celui de l'article existant, celui choisi, sinon celui de
// sa catégorie.
export function locationOf(line: ScanLine): InventoryLocation | null {
  if (line.existing) return line.existing.location;
  if (line.location) return line.location;
  return line.category ? DEFAULT_LOCATION[line.category] : null;
}

function purchaseOfLine(line: ScanLine): FormResult<PurchaseItem> {
  const label = `« ${line.name} »`;
  const item: Record<string, unknown> = { ...line.choice };

  if (line.existing) {
    item.name = line.existing.name;
    item.category = line.existing.category;
    item.item_id = line.existing.id;
  } else {
    if (line.category === null) return fail(`${label} : choisis une catégorie.`);
    item.name = line.name;
    item.category = line.category;
    if (line.location) item.location = line.location;
    // Produit scanné : son aliment de référence est connu, rien à rapprocher.
    if (line.food && line.choice === null) item.food_ref_id = line.food.id;
  }

  const byLevel = line.existing !== null && line.existing.level !== null;
  if (!byLevel && line.quantity.trim() !== "") {
    const quantity = parseQuantity(line.quantity);
    if (quantity === null || quantity === 0) {
      return fail(`${label} : la quantité doit être un nombre positif.`);
    }
    item.quantity = quantity;
    item.unit = line.unit;
  } else if (line.existing !== null && !byLevel) {
    return fail(`${label} est suivi en quantité : indique combien tu en as acheté.`);
  }

  const parsed = PurchaseItem.safeParse(item);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : fail(`${label} : ${parsed.error.issues[0]?.message ?? "saisie invalide"}`);
}

// Les achats de toute la liste, pour un seul appel à add_items (une transaction).
export function purchasesOf(lines: ScanLine[]): FormResult<PurchaseItem[]> {
  if (lines.length === 0) return fail("La liste est vide : scanne ou ajoute un produit.");
  const items: PurchaseItem[] = [];
  for (const line of lines) {
    const purchase = purchaseOfLine(line);
    if (!purchase.ok) return purchase;
    items.push(purchase.value);
  }
  return { ok: true, value: items };
}

// Après l'envoi : les lignes rangées disparaissent ; celles qu'add_items a jugées ambiguës
// restent, avec de quoi trancher. Chaque ambiguïté porte la position de son article dans la
// liste envoyée : deux lignes de même nom ne se confondent pas.
export function remainingLines(sent: ScanLine[], result: AddItemsResult): ScanLine[] {
  return result.ambiguous.flatMap((ambiguity) => {
    const line = sent[ambiguity.index];
    return line ? [{ ...line, ambiguity, choice: null }] : [];
  });
}

export type ScanSummary = { created: string[]; restocked: string[]; noLongerToRestock: string[] };

// Ce qui a été rangé, et les articles qui sortent de la liste « À racheter ».
export function summaryOf(result: AddItemsResult, before: InventoryRow[]): ScanSummary {
  const wasLow = new Set(before.filter((item) => item.low_stock).map((item) => item.id));
  return {
    created: result.created.map((item) => item.name),
    restocked: result.restocked.map((item) => item.name),
    noLongerToRestock: result.restocked
      .filter((item) => wasLow.has(item.id) && item.low_stock !== true)
      .map((item) => item.name),
  };
}

export function mergeSummaries(a: ScanSummary | null, b: ScanSummary): ScanSummary {
  if (a === null) return b;
  return {
    created: [...a.created, ...b.created],
    restocked: [...a.restocked, ...b.restocked],
    noLongerToRestock: [...a.noLongerToRestock, ...b.noLongerToRestock],
  };
}
