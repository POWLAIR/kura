import { corsHeaders, isAllowedOrigin } from "./cors.ts";
import { errorCode, log } from "./log.ts";
import { bearerToken, type FindUser } from "./session.ts";

// Entrée commune des fonctions appelées par l'app (api, off-product) : origine, méthode,
// session. Réponses JSON : { error: { code, message } } en cas de refus.

export type SessionDeps = {
  findUser: FindUser;
  // Origines de l'app web (KURA_APP_ORIGINS) ; localhost est toujours accepté.
  appOrigins: string[];
};

export type Caller = { userId: string; origin: string | null };

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function json(
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

// L'utilisateur de la requête, ou la réponse de refus à renvoyer telle quelle.
export async function authenticate(
  request: Request,
  { findUser, appOrigins }: SessionDeps,
): Promise<Caller | Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin, appOrigins)) {
    return json(403, errorBody("origin_refused", "Origine non autorisée"), null);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
  }
  if (request.method !== "POST") {
    return json(405, errorBody("method_not_allowed", "Seul POST est accepté"), origin);
  }

  const token = bearerToken(request.headers);
  let userId: string | null = null;
  try {
    userId = token ? await findUser(token, request.headers.get("apikey")) : null;
  } catch (failure) {
    // Auth injoignable : surtout pas un 401, l'app croirait la session terminée.
    log("auth_unavailable", { code: errorCode(failure) });
    return json(503, errorBody("auth_unavailable", "Réessaie dans un moment"), origin, {
      "retry-after": "5",
    });
  }
  if (!userId) {
    log("auth_refused", { reason: token ? "invalid_token" : "missing_token" });
    return json(401, errorBody("unauthenticated", "Session absente ou expirée"), origin);
  }
  return { userId, origin };
}

// Corps JSON validé par un schéma Zod, ou la réponse 400. Les problèmes de validation
// donnent les chemins et les messages, jamais les valeurs saisies.
export async function readInput<T>(
  request: Request,
  schema: {
    safeParse: (
      value: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  origin: string | null,
): Promise<{ input: T } | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, errorBody("invalid_json", "Corps JSON attendu"), origin);
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return { input: parsed.data };
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return json(
    400,
    { error: { code: "invalid_input", message: "Saisie invalide", issues } },
    origin,
  );
}
