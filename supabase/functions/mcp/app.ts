import { asUser, findCaller, type Sql } from "../_shared/db.ts";
import { createHandler, type OAuthDeps } from "./handler.ts";
import { buildServer } from "./server.ts";

// Assemblage du serveur sur une connexion Postgres : utilisé par index.ts et les tests
// d'intégration. Sans oauth, seule la clé API est acceptée.
export function createApp(sql: Sql, oauth?: OAuthDeps) {
  return createHandler({
    findCaller: (keyHash) => findCaller(sql, keyHash),
    buildServer: (caller) => buildServer((fn) => asUser(sql, caller.userId, fn)),
    ...(oauth && { oauth }),
  });
}
