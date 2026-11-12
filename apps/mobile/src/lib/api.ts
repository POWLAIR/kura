import { FunctionsHttpError } from "@supabase/supabase-js";
import { ApiError, apiErrorFrom, NETWORK_MESSAGE } from "./api-error";
import { supabase } from "./supabase";

// Appels aux Edge Functions de l'app, avec la session de l'utilisateur.

async function invoke<T>(path: string, input: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(path, { body: input ?? {} });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Corps illisible : message générique.
    }
    throw apiErrorFrom(response.status, body);
  }
  throw new ApiError("network", NETWORK_MESSAGE);
}

// Exécute une opération métier : la même que le tool MCP du même nom (voir docs/api.md).
export function callApi<T>(operation: string, input?: unknown): Promise<T> {
  return invoke<T>(`api/${operation}`, input);
}

// Produit Open Food Facts par code-barres, mis en cache dans food_ref (voir
// docs/open-food-facts.md).
export function callOffProduct<T>(ean: string): Promise<T> {
  return invoke<T>("off-product", { ean });
}
