import {
  CATEGORY_LABELS,
  InventoryCategory,
  InventoryLocation,
  LEVEL_LABELS,
  LOCATION_LABELS,
  type PurchaseUnit,
  StockLevel,
} from "@kura/core";

// Options des formulaires de l'onglet Cuisine, dans l'ordre de la conception.

export const CATEGORY_OPTIONS = InventoryCategory.options.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const LOCATION_OPTIONS = InventoryLocation.options.map((value) => ({
  value,
  label: LOCATION_LABELS[value],
}));

export const LEVEL_OPTIONS = StockLevel.options.map((value) => ({
  value,
  label: LEVEL_LABELS[value],
}));

export const UNIT_OPTIONS: readonly { value: PurchaseUnit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
  { value: "piece", label: "pièce" },
];

export const UNIT_LABELS = { g: "g", ml: "ml", piece: "pièces" } as const;
