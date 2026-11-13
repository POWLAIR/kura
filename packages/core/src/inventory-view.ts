import type { z } from "zod";
import type { Food } from "./food-match.ts";
import type { AmbiguityReason } from "./purchase.ts";
import {
  InventoryCategory,
  InventoryLocation,
  type QuantityUnit,
  type StockLevel,
} from "./schemas.ts";

// Affichage de l'inventaire, partagé par les écrans de l'app : libellés français,
// regroupement par emplacement puis catégorie, quantité lisible, état de péremption.

type Category = z.infer<typeof InventoryCategory>;
type Location = z.infer<typeof InventoryLocation>;
type Unit = z.infer<typeof QuantityUnit>;
type Level = z.infer<typeof StockLevel>;

export const LOCATION_LABELS = {
  placard: "Placard",
  frigo: "Frigo",
  congelateur: "Congélateur",
} as const satisfies Record<Location, string>;

export const CATEGORY_LABELS = {
  epices: "Épices",
  feculents: "Féculents",
  sauces: "Sauces",
  frais: "Frais",
  fait_maison: "Fait maison",
} as const satisfies Record<Category, string>;

export const LEVEL_LABELS = {
  plein: "Plein",
  moitie: "Moitié",
  presque_vide: "Presque vide",
} as const satisfies Record<Level, string>;

// Article tel que le renvoient get_inventory, add_items et update_item : les champs vides
// sont omis.
export type InventoryItemView = {
  id: number;
  name: string;
  category: Category;
  location: Location;
  quantity?: number;
  unit?: Unit;
  level?: Level;
  expires_on?: string;
  restock_threshold?: number;
  restock_level?: Level;
  low_stock?: true;
  food?: { id: number; name: string | null };
};

// Article ambigu renvoyé par add_items : de quoi trancher, puis relancer.
export type PurchaseAmbiguity = {
  // Position de l'article dans la liste envoyée à add_items.
  index: number;
  name: string;
  reason: AmbiguityReason;
  hint: string;
  candidates: { food_ref_id: Food["id"]; name: string }[];
  items: { item_id: number; name: string; location: Location; amount: string }[];
};

export type AddItemsResult = {
  replayed?: true;
  created: InventoryItemView[];
  restocked: InventoryItemView[];
  ambiguous: PurchaseAmbiguity[];
};

// ---------------------------------------------------------------------------
// Quantité
// ---------------------------------------------------------------------------

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

// « 1,5 kg », « 250 ml », « 6 pièces », « Moitié ».
export function formatAmount(item: {
  quantity?: number | null;
  unit?: Unit | null;
  level?: Level | null;
}): string {
  if (item.level) return LEVEL_LABELS[item.level];
  const quantity = item.quantity ?? 0;
  if (item.unit === "piece") {
    return `${decimal.format(quantity)} ${quantity > 1 ? "pièces" : "pièce"}`;
  }
  if (item.unit === "g" && quantity >= 1000) return `${decimal.format(quantity / 1000)} kg`;
  if (item.unit === "ml" && quantity >= 1000) return `${decimal.format(quantity / 1000)} l`;
  return `${decimal.format(quantity)} ${item.unit ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Péremption
// ---------------------------------------------------------------------------

// Une date est « proche » à partir de trois jours : le temps de cuisiner le produit.
export const EXPIRY_SOON_DAYS = 3;

export type ExpiryStatus =
  | { kind: "none" }
  | { kind: "later"; days: number }
  | { kind: "soon"; days: number } // 0 = aujourd'hui
  | { kind: "expired"; days: number }; // jours écoulés depuis la date

const DAY_MS = 86_400_000;

// `today` et `expiresOn` sont des dates AAAA-MM-JJ (la journée de Paris, voir localDate).
export function expiryStatus(expiresOn: string | null | undefined, today: string): ExpiryStatus {
  if (!expiresOn) return { kind: "none" };
  const days = Math.round((Date.parse(expiresOn) - Date.parse(today)) / DAY_MS);
  if (days < 0) return { kind: "expired", days: -days };
  return days <= EXPIRY_SOON_DAYS ? { kind: "soon", days } : { kind: "later", days };
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// Libellé neutre : un fait sur le produit, jamais un reproche.
export function expiryLabel(expiresOn: string | null | undefined, today: string): string | null {
  const status = expiryStatus(expiresOn, today);
  switch (status.kind) {
    case "none":
      return null;
    case "expired":
      return status.days === 1 ? "Périmé depuis hier" : `Périmé depuis ${status.days} jours`;
    case "soon":
      if (status.days === 0) return "Périme aujourd'hui";
      return status.days === 1 ? "Périme demain" : `Périme dans ${status.days} jours`;
    case "later":
      return `Jusqu'au ${dayMonth.format(new Date(`${expiresOn}T00:00:00Z`))}`;
  }
}

// ---------------------------------------------------------------------------
// Saisie d'une date
// ---------------------------------------------------------------------------

// Sans année, une date passée depuis moins longtemps que cela reste dans l'année en cours :
// « 10/11 » tapé le 12 novembre désigne un produit déjà périmé, pas novembre prochain.
export const RECENT_PAST_DAYS = 30;

// Date tapée à la française : « 12/11 », « 12/11/26 », « 12/11/2026 », ou AAAA-MM-JJ.
// Sans année, c'est la prochaine occurrence à partir de `today`, ou une date passée depuis
// peu (RECENT_PAST_DAYS). Renvoie AAAA-MM-JJ, ou null si la saisie n'est pas une date.
// `past` : pour une entrée du journal, sans année c'est la dernière fois que cette date est
// arrivée, aujourd'hui compris.
export function parseDateInput(
  input: string,
  today: string,
  options: { past?: boolean } = {},
): string | null {
  const text = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const french = /^(\d{1,2})[/.\s-](\d{1,2})(?:[/.\s-](\d{2}|\d{4}))?$/.exec(text);
  if (!french) return null;
  const [day, month] = [Number(french[1]), Number(french[2])];
  if (french[3] !== undefined) {
    const year = french[3].length === 2 ? 2000 + Number(french[3]) : Number(french[3]);
    return toIsoDate(year, month, day);
  }

  if (options.past) {
    for (let year = Number(today.slice(0, 4)); year >= Number(today.slice(0, 4)) - 4; year--) {
      const date = toIsoDate(year, month, day);
      if (date !== null && date <= today) return date;
    }
    return null;
  }

  const earliest = new Date(Date.parse(today) - RECENT_PAST_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  // Jusqu'à quatre ans plus tard : un 29 février n'existe pas tous les ans.
  for (let year = Number(earliest.slice(0, 4)); year <= Number(today.slice(0, 4)) + 4; year++) {
    const date = toIsoDate(year, month, day);
    if (date !== null && date >= earliest) return date;
  }
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

// « 2026-11-12 » → « 12/11/2026 », pour préremplir un champ de saisie.
export function formatDateInput(isoDate: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

// ---------------------------------------------------------------------------
// Regroupement
// ---------------------------------------------------------------------------

export type InventoryGroup<T> = {
  location: Location;
  label: string;
  categories: { category: Category; label: string; items: T[] }[];
};

const collator = new Intl.Collator("fr", { sensitivity: "base" });

// Par emplacement (placard, frigo, congélateur) puis par catégorie, dans l'ordre de la
// conception ; les articles par nom. Les emplacements et catégories vides sont omis.
export function groupInventory<T extends { name: string; location: Location; category: Category }>(
  items: T[],
): InventoryGroup<T>[] {
  return InventoryLocation.options
    .map((location) => ({
      location,
      label: LOCATION_LABELS[location],
      categories: InventoryCategory.options
        .map((category) => ({
          category,
          label: CATEGORY_LABELS[category],
          items: items
            .filter((item) => item.location === location && item.category === category)
            .sort((a, b) => collator.compare(a.name, b.name)),
        }))
        .filter((group) => group.items.length > 0),
    }))
    .filter((group) => group.categories.length > 0);
}
