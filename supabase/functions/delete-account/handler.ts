import { DeleteAccountInput } from "@kura/core";
import { authenticate, errorBody, json, readInput, type SessionDeps } from "../_shared/http.ts";
import { errorCode, log } from "../_shared/log.ts";

export type HandlerDeps = SessionDeps & {
  // Supprime le compte Supabase Auth ; toutes les lignes de l'utilisateur partent avec lui
  // (chaque table référence auth.users en `on delete cascade`).
  deleteUser: (userId: string) => Promise<void>;
};

// Suppression totale du compte : POST /functions/v1/delete-account, corps
// { "confirm": "SUPPRIMER" }, avec la session de l'utilisateur. Il ne peut supprimer que
// son propre compte : l'id vient de sa session, jamais du corps de la requête.
export function createHandler({ deleteUser, ...session }: HandlerDeps) {
  return async (request: Request): Promise<Response> => {
    const caller = await authenticate(request, session);
    if (caller instanceof Response) return caller;
    const { userId, origin } = caller;

    const parsed = await readInput(request, DeleteAccountInput, origin);
    if (parsed instanceof Response) return parsed;

    try {
      await deleteUser(userId);
    } catch (failure) {
      // Seulement le code : ni l'identité ni le contenu du compte.
      log("delete_account_error", { code: errorCode(failure) });
      return json(
        502,
        errorBody("delete_failed", "La suppression n'a pas abouti : rien n'a été supprimé."),
        origin,
      );
    }
    return json(200, { deleted: true }, origin);
  };
}
