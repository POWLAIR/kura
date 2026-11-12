import type { Tx } from "../_shared/db.ts";
import { userErrorMessage } from "../_shared/errors.ts";
import { errorCode, log } from "../_shared/log.ts";
import { isOperationName, OPERATIONS } from "../_shared/operations.ts";
import { bearerToken, type FindUser } from "./auth.ts";
import { corsHeaders, isAllowedOrigin } from "./cors.ts";

export type HandlerDeps = {
  findUser: FindUser;
  // Transaction de l'utilisateur, sous RLS (voir _shared/db.ts).
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  appOrigins: string[];
};

// API de l'app : POST /functions/v1/api/<opération>, corps JSON = entrée de l'opération.
// Les opérations sont celles des tools MCP (_shared/operations.ts) : mêmes schémas Zod,
// mêmes réponses. Voir docs/api.md.
export function createHandler({ findUser, asUser, appOrigins }: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    if (origin !== null && !isAllowedOrigin(origin, appOrigins)) {
      return json(403, error("origin_refused", "Origine non autorisée"), null);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
    }
    if (request.method !== "POST") {
      return json(405, error("method_not_allowed", "Seul POST est accepté"), origin);
    }

    const name = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!isOperationName(name)) {
      return json(404, error("unknown_operation", "Opération inconnue"), origin);
    }

    const token = bearerToken(request.headers);
    let userId: string | null = null;
    try {
      userId = token ? await findUser(token, request.headers.get("apikey")) : null;
    } catch (failure) {
      // Auth injoignable : surtout pas un 401, l'app croirait la session terminée.
      log("auth_unavailable", { code: errorCode(failure) });
      return json(503, error("auth_unavailable", "Réessaie dans un moment"), origin, {
        "retry-after": "5",
      });
    }
    if (!userId) {
      log("auth_refused", { reason: token ? "invalid_token" : "missing_token" });
      return json(401, error("unauthenticated", "Session absente ou expirée"), origin);
    }

    // Corps vide = entrée vide : c'est l'appel normal d'une lecture (get_inventory…).
    let body: unknown;
    try {
      const text = await request.text();
      body = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return json(400, error("invalid_json", "Corps JSON attendu"), origin);
    }
    const operation = OPERATIONS[name];
    const input = operation.input.safeParse(body);
    if (!input.success) {
      // Chemins et messages de validation : jamais les valeurs saisies.
      const issues = input.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return json(
        400,
        { error: { code: "invalid_input", message: "Saisie invalide", issues } },
        origin,
      );
    }

    try {
      const run = operation.run as (tx: Tx, input: unknown) => Promise<unknown>;
      return json(200, await asUser(userId, (tx) => run(tx, input.data)), origin);
    } catch (failure) {
      // Saisie refusée par nos fonctions (article introuvable, unité incompatible…) : le
      // message, en français, est fait pour l'utilisateur.
      const message = userErrorMessage(failure);
      if (message !== null) return json(422, error("refused", message), origin);
      // Autre erreur : seulement son code dans les logs, jamais son message.
      log("api_error", { operation: name, code: errorCode(failure) });
      return json(500, error("internal", "Erreur interne"), origin);
    }
  };
}

function error(code: string, message: string) {
  return { error: { code, message } };
}

function json(
  status: number,
  body: unknown,
  origin: string | null,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(origin ? corsHeaders(origin) : {}),
      ...headers,
    },
  });
}
