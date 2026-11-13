// Suppression totale du compte. Voir docs/api.md.
//
// C'est la seule fonction de Kura à utiliser la clé service_role : supprimer un compte
// Supabase Auth demande l'API d'administration. La clé reste ici, côté serveur ; elle ne
// sert qu'à cet appel, pour le compte de l'utilisateur authentifié.
import { parseOrigins } from "../_shared/cors.ts";
import { authUserFinder } from "../_shared/session.ts";
import { createHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant");
}

class AdminError extends Error {
  code: string;
  constructor(status: number) {
    super("Suppression refusée par Supabase Auth");
    this.name = "AdminError";
    this.code = `auth_admin_http_${status}`;
  }
}

async function deleteUser(userId: string): Promise<void> {
  const response = await fetch(new URL(`/auth/v1/admin/users/${userId}`, supabaseUrl), {
    method: "DELETE",
    headers: { apikey: serviceRoleKey as string, authorization: `Bearer ${serviceRoleKey}` },
  });
  await response.body?.cancel();
  if (!response.ok) throw new AdminError(response.status);
}

Deno.serve(
  createHandler({
    findUser: authUserFinder(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? null),
    appOrigins: parseOrigins(Deno.env.get("KURA_APP_ORIGINS")),
    deleteUser,
  }),
);
