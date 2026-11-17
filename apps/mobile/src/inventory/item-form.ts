import {
  type AmbiguityReason,
  formatDateInput,
  type InventoryCategory,
  type InventoryLocation,
  ItemChanges,
  type PurchaseAmbiguity,
  PurchaseItem,
  type PurchaseUnit,
  parseDateInput,
  type QuantityUnit,
  type StockLevel,
  toStockAmount,
} from "@kura/core";

// Formulaires de l'onglet Cuisine : du texte saisi aux entrées des opérations add_items et
// update_item, validées par les schémas Zod de @kura/core. Sans React : testé avec Vitest.

// Article tel que le lit l'app dans la vue inventory_status.
export type InventoryRow = {
  id: number;
  name: string;
  category: InventoryCategory;
  location: InventoryLocation;
  quantity: number | null;
  unit: QuantityUnit | null;
  level: StockLevel | null;
  expires_on: string | null;
  restock_threshold: number | null;
  restock_level: StockLevel | null;
  food_ref_id: number | null;
  food_name: string | null;
  low_stock: boolean;
};

export type FormResult<T> = { ok: true; value: T } | { ok: false; message: string };

const fail = (message: string): FormResult<never> => ({ ok: false, message });

const DATE_MESSAGE = "Date : écris-la comme 24/12 ou 24/12/2026.";

// « 1,5 » ou « 1.5 » → 1.5 ; null si ce n'est pas un nombre positif ou nul.
export function parseQuantity(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Saisie invalide.";
}

// ---------------------------------------------------------------------------
// Ajouter un article
// ---------------------------------------------------------------------------

export type PurchaseForm = {
  name: string;
  category: InventoryCategory | null;
  quantity: string; // vide : article suivi en niveau (pot, bouteille, épice)
  unit: PurchaseUnit;
  location: InventoryLocation | null; // null : selon la catégorie
  expires: string;
};

export const EMPTY_PURCHASE: PurchaseForm = {
  name: "",
  category: null,
  quantity: "",
  unit: "g",
  location: null,
  expires: "",
};

// Précision donnée après une ambiguïté : l'aliment de référence choisi (null : aucun), ou
// l'article existant à réapprovisionner.
export type PurchaseChoice = { food_ref_id?: number | null; item_id?: number };

export function purchaseOf(
  form: PurchaseForm,
  today: string,
  choice: PurchaseChoice = {},
): FormResult<PurchaseItem> {
  if (form.name.trim() === "") return fail("Donne un nom à l'article.");
  if (form.category === null) return fail("Choisis une catégorie.");

  const item: Record<string, unknown> = { name: form.name, category: form.category, ...choice };
  if (form.quantity.trim() !== "") {
    const quantity = parseQuantity(form.quantity);
    if (quantity === null || quantity === 0) {
      return fail("Quantité : un nombre positif est attendu, ou rien pour un suivi en niveau.");
    }
    item.quantity = quantity;
    item.unit = form.unit;
  }
  if (form.location !== null) item.location = form.location;
  if (form.expires.trim() !== "") {
    const date = parseDateInput(form.expires, today);
    if (date === null) return fail(DATE_MESSAGE);
    item.expires_on = date;
  }

  const parsed = PurchaseItem.safeParse(item);
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}

// Ce que l'app dit à l'utilisateur pour chaque ambiguïté d'add_items. Les indications
// renvoyées par le serveur (hint) sont écrites pour Claude, pas pour l'écran.
const AMBIGUITY_MESSAGES: Record<AmbiguityReason, string> = {
  food: "Plusieurs aliments de référence correspondent. Lequel est-ce ?",
  several_items: "Plusieurs articles en stock portent ce nom. Lequel réapprovisionner ?",
  quantity_required: "Cet article est suivi en quantité : indique combien tu en as acheté.",
  unit_mismatch:
    "Cet article est suivi dans une autre unité. Donne la quantité dans cette unité, ou corrige l'article.",
  unknown_item: "Cet article n'est plus dans l'inventaire. Recommence l'ajout.",
  unknown_food: "Cet aliment de référence n'existe plus. Recommence l'ajout.",
};

// Aucun aliment de référence ni article existant à proposer : le nom n'a rien donné.
export function hasNoMatch(ambiguity: PurchaseAmbiguity): boolean {
  return (
    ambiguity.reason === "food" && ambiguity.candidates.length === 0 && ambiguity.items.length === 0
  );
}

export function ambiguityMessage(ambiguity: PurchaseAmbiguity): string {
  return hasNoMatch(ambiguity)
    ? "Aucun aliment de référence ne porte ce nom : l'article n'aura pas de valeurs nutritionnelles. Tu pourras lui en choisir un dans sa fiche."
    : AMBIGUITY_MESSAGES[ambiguity.reason];
}

// ---------------------------------------------------------------------------
// Modifier un article
// ---------------------------------------------------------------------------

export type ItemForm = {
  name: string;
  category: InventoryCategory;
  location: InventoryLocation;
  mode: "quantity" | "level";
  quantity: string;
  unit: PurchaseUnit;
  level: StockLevel;
  expires: string; // vide : pas de date
  restockThreshold: string; // vide : pas de seuil ; dans l'unité de stock (g, ml, pièce)
  restockLevel: StockLevel | null;
  foodRefId: number | null;
};

export function formOf(item: InventoryRow): ItemForm {
  return {
    name: item.name,
    category: item.category,
    location: item.location,
    mode: item.level === null ? "quantity" : "level",
    quantity: item.quantity === null ? "" : String(item.quantity).replace(".", ","),
    unit: item.unit ?? "g",
    level: item.level ?? "plein",
    expires: formatDateInput(item.expires_on),
    restockThreshold:
      item.restock_threshold === null ? "" : String(item.restock_threshold).replace(".", ","),
    restockLevel: item.restock_level,
    foodRefId: item.food_ref_id,
  };
}

// Unité dans laquelle l'article sera stocké, et donc celle de son seuil de rachat.
export function stockUnitOf(form: ItemForm): QuantityUnit {
  return toStockAmount(1, form.unit).unit;
}

// Les seuls champs modifiés, prêts pour update_item ; null s'il n'y a rien à enregistrer.
export function changesOf(
  item: InventoryRow,
  form: ItemForm,
  today: string,
): FormResult<ItemChanges | null> {
  const changes: Record<string, unknown> = {};

  const name = form.name.trim();
  if (name === "") return fail("Le nom ne peut pas être vide.");
  if (name !== item.name) changes.name = name;
  if (form.category !== item.category) changes.category = form.category;
  if (form.location !== item.location) changes.location = form.location;
  if (form.foodRefId !== item.food_ref_id) changes.food_ref_id = form.foodRefId;

  let expires: string | null = null;
  if (form.expires.trim() !== "") {
    expires = parseDateInput(form.expires, today);
    if (expires === null) return fail(DATE_MESSAGE);
  }
  if (expires !== item.expires_on) changes.expires_on = expires;

  if (form.mode === "quantity") {
    const quantity = parseQuantity(form.quantity);
    if (quantity === null) return fail("Quantité : un nombre est attendu.");
    const stock = toStockAmount(quantity, form.unit);
    const sameTracking = item.level === null && item.unit === stock.unit;
    if (!sameTracking || stock.quantity !== item.quantity) {
      changes.quantity = quantity;
      changes.unit = form.unit;
    }

    let threshold: number | null = null;
    if (form.restockThreshold.trim() !== "") {
      threshold = parseQuantity(form.restockThreshold);
      if (threshold === null) return fail("Seuil de rachat : un nombre est attendu.");
    }
    // Un changement d'unité ou de mode efface l'ancien seuil côté serveur.
    const previous = sameTracking ? item.restock_threshold : null;
    if (threshold !== previous) changes.restock_threshold = threshold;
  } else {
    const wasLevel = item.level !== null;
    if (!wasLevel || form.level !== item.level) changes.level = form.level;
    const previous = wasLevel ? item.restock_level : null;
    if (form.restockLevel !== previous) changes.restock_level = form.restockLevel;
  }

  if (Object.keys(changes).length === 0) return { ok: true, value: null };
  const parsed = ItemChanges.safeParse(changes);
  return parsed.success ? { ok: true, value: parsed.data } : fail(firstIssue(parsed.error));
}
