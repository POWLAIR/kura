import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { NETWORK_MESSAGE } from "@/lib/api-error";
import { supabase } from "@/lib/supabase";
import type { InventoryRow } from "./item-form";

const COLUMNS =
  "id, name, category, location, quantity, unit, level, expires_on, restock_threshold, restock_level, food_ref_id, food_name, low_stock";

type State = { items: InventoryRow[]; loading: boolean; error: string | null };

// Lecture directe de la vue inventory_status, sous la RLS de l'utilisateur. La vue ne
// garantit aucun champ : les lignes sans id sont écartées.
function toRows(data: Record<string, unknown>[] | null): InventoryRow[] {
  return (data ?? [])
    .filter((row) => row.id !== null && row.name !== null)
    .map((row) => ({ ...row, low_stock: row.low_stock === true }) as InventoryRow);
}

// Inventaire de l'utilisateur, relu à chaque retour sur l'écran.
export function useInventory() {
  const [state, setState] = useState<State>({ items: [], loading: true, error: null });

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("inventory_status").select(COLUMNS).order("name");
    setState((previous) =>
      error
        ? { ...previous, loading: false, error: NETWORK_MESSAGE }
        : { items: toRows(data), loading: false, error: null },
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { ...state, reload };
}

// Un article par son id, ou null s'il n'existe pas (ou plus).
export async function fetchItem(id: number): Promise<InventoryRow | null> {
  const { data, error } = await supabase
    .from("inventory_status")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return toRows(data ? [data] : [])[0] ?? null;
}

export type FoodHit = { id: number; name: string; brand: string | null };

// Recherche d'un aliment de référence par son nom (Ciqual et produits scannés).
export async function searchFoods(query: string): Promise<FoodHit[]> {
  const pattern = `%${query.trim().replace(/[%_\\]/g, "\\$&")}%`;
  const { data, error } = await supabase
    .from("food_ref")
    .select("id, name, brand")
    .ilike("name", pattern)
    .order("name")
    .limit(20);
  if (error) throw error;
  return data ?? [];
}
