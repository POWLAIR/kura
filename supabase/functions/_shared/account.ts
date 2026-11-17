import type { DataExport } from "@kura/core";
import type { Tx } from "./db.ts";

// Export complet des données de l'utilisateur (issue #31). Exécuté dans asUser : la RLS
// garantit que seules ses lignes sortent. Réservé à l'API de l'app, pas de tool MCP.

// Tables de l'utilisateur, exportées telles quelles. idempotent_call n'y figure pas : c'est
// un cache technique de réponses déjà présentes dans les autres tables.
const USER_TABLES = [
  "inventory_item",
  "stock_movement",
  "recipe",
  "recipe_ingredient",
  "meal",
  "meal_item",
  "workout",
  "body_measure",
  "food_conversion",
  "companion_event",
] as const;

export async function exportData(tx: Tx): Promise<DataExport> {
  const tables: DataExport["tables"] = {};
  for (const table of USER_TABLES) {
    tables[table] = await tx`select * from public.${tx(table)} order by created_at, 1`;
  }
  // Clés du connecteur : jamais leur hash.
  tables.api_key = await tx`
    select id, label, key_prefix, created_at, last_used_at, revoked_at
    from public.api_key order by created_at`;
  // Aliments de référence cités par ces lignes, pour que l'export se lise seul.
  tables.food_ref = await tx`
    select f.id, f.source, f.code, f.name, f.brand
    from public.food_ref f
    where f.id in (
      select food_ref_id from public.inventory_item
      union select food_ref_id from public.meal_item
      union select food_ref_id from public.recipe_ingredient
      union select food_ref_id from public.food_conversion
    )
    order by f.id`;
  return { format: 1, exported_at: new Date().toISOString(), tables };
}
