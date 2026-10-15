import { asUser, findCaller, type Sql } from "./db.ts";
import { createHandler } from "./handler.ts";
import { buildServer } from "./server.ts";

// Assemblage du serveur sur une connexion Postgres : utilisé par index.ts et les tests
// d'intégration.
export function createApp(sql: Sql) {
  return createHandler({
    findCaller: (keyHash) => findCaller(sql, keyHash),
    buildServer: (caller) => buildServer((fn) => asUser(sql, caller.userId, fn)),
  });
}
