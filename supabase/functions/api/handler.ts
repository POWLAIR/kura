import type { Tx } from "../_shared/db.ts";
import { userErrorMessage } from "../_shared/errors.ts";
import { authenticate, errorBody, json, readInput, type SessionDeps } from "../_shared/http.ts";
import { errorCode, log } from "../_shared/log.ts";
import { isOperationName, OPERATIONS } from "../_shared/operations.ts";

export type HandlerDeps = SessionDeps & {
  // Transaction de l'utilisateur, sous RLS (voir _shared/db.ts).
  asUser: <T>(userId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

// API de l'app : POST /functions/v1/api/<opération>, corps JSON = entrée de l'opération.
// Les opérations sont celles des tools MCP (_shared/operations.ts) : mêmes schémas Zod,
// mêmes réponses. Voir docs/api.md.
export function createHandler({ asUser, ...session }: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    const caller = await authenticate(request, session);
    if (caller instanceof Response) return caller;
    const { userId, origin } = caller;

    const name = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (!isOperationName(name)) {
      return json(404, errorBody("unknown_operation", "Opération inconnue"), origin);
    }
    const operation = OPERATIONS[name];
    const parsed = await readInput<unknown>(request, operation.input, origin);
    if (parsed instanceof Response) return parsed;

    try {
      const run = operation.run as (tx: Tx, input: unknown) => Promise<unknown>;
      return json(200, await asUser(userId, (tx) => run(tx, parsed.input)), origin);
    } catch (failure) {
      // Saisie refusée par nos fonctions (article introuvable, unité incompatible…) : le
      // message, en français, est fait pour l'utilisateur.
      const message = userErrorMessage(failure);
      if (message !== null) return json(422, errorBody("refused", message), origin);
      // Autre erreur : seulement son code dans les logs, jamais son message.
      log("api_error", { operation: name, code: errorCode(failure) });
      return json(500, errorBody("internal", "Erreur interne"), origin);
    }
  };
}
