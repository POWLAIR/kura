import { type Ean, mapOffProduct, type OffFood, OffProductInput, offProductUrl } from "@kura/core";
import type postgres from "postgres";
import type { Sql } from "../_shared/db.ts";
import { authenticate, errorBody, json, readInput, type SessionDeps } from "../_shared/http.ts";
import { errorCode, log } from "../_shared/log.ts";

export type HandlerDeps = SessionDeps & {
  // Connexion directe : cette fonction est la seule à écrire dans food_ref, que la RLS
  // laisse en lecture seule aux utilisateurs.
  sql: Sql;
  fetchOff: typeof fetch;
  // « NomApp/Version (contact) », comme le demande l'API d'Open Food Facts.
  userAgent: string;
};

const OFF_TIMEOUT_MS = 8_000;

class OffUnavailableError extends Error {
  code: string;
  constructor(status: number) {
    super("Open Food Facts indisponible");
    this.name = "OffUnavailableError";
    this.code = `off_http_${status}`;
  }
}

// Produit en cache, tel que le renvoie la fonction.
function findFood(sql: Sql, ean: Ean) {
  return sql`
    select id, code, name, brand, package_quantity, package_unit, per_100_unit,
      energy_kcal, protein_g, carbs_g, sugars_g, fat_g, saturated_fat_g, fiber_g, salt_g,
      micronutrients, nutrient_details
    from public.food_ref where source = 'off' and code = ${ean}`.then(([row]) => row ?? null);
}

// Deux scans simultanés du même produit : le second ne réécrit rien (unique (source, code)).
async function cacheFood(sql: Sql, food: OffFood) {
  const { micronutrients, nutrient_details, ...columns } = food;
  await sql`
    insert into public.food_ref ${sql({
      source: "off",
      ...columns,
      micronutrients: sql.json(micronutrients as postgres.JSONValue),
      nutrient_details: sql.json(nutrient_details as postgres.JSONValue),
    })}
    on conflict (source, code) do nothing`;
}

// Seul le code-barres part vers Open Food Facts : ni jeton, ni identifiant de l'utilisateur.
async function fetchProduct(deps: HandlerDeps, ean: Ean): Promise<unknown> {
  const response = await deps.fetchOff(offProductUrl(ean), {
    headers: { "user-agent": deps.userAgent, accept: "application/json" },
    signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OffUnavailableError(response.status);
  }
  return await response.json();
}

// Produit par code-barres : POST /functions/v1/off-product, corps { "ean": "…" }.
// Déjà en cache : aucune requête vers Open Food Facts. Voir docs/open-food-facts.md.
export function createHandler(deps: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    const caller = await authenticate(request, deps);
    if (caller instanceof Response) return caller;
    const { origin } = caller;

    const parsed = await readInput(request, OffProductInput, origin);
    if (parsed instanceof Response) return parsed;
    const { ean } = parsed.input;

    try {
      const cached = await findFood(deps.sql, ean);
      if (cached) return json(200, { found: true, cached: true, food: cached }, origin);

      let payload: unknown;
      try {
        payload = await fetchProduct(deps, ean);
      } catch (failure) {
        log("off_unavailable", { code: errorCode(failure) });
        return json(
          502,
          errorBody(
            "off_unavailable",
            "Open Food Facts ne répond pas. Réessaie, ou saisis l'article à la main.",
          ),
          origin,
        );
      }

      const food = mapOffProduct(ean, payload);
      // Code inconnu d'Open Food Facts, ou fiche sans nom : l'article se saisit à la main.
      if (!food) return json(200, { found: false, ean }, origin);

      await cacheFood(deps.sql, food);
      return json(200, { found: true, cached: false, food: await findFood(deps.sql, ean) }, origin);
    } catch (failure) {
      log("off_product_error", { code: errorCode(failure) });
      return json(500, errorBody("internal", "Erreur interne"), origin);
    }
  };
}
