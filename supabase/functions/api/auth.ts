// Authentification de l'API de l'app : le jeton de session Supabase de l'utilisateur.

// Id de l'utilisateur du jeton, ou null si le jeton est refusé. Lève une erreur si le
// service d'authentification ne répond pas (l'appelant renvoie alors un 503).
export type FindUser = (token: string, apiKey: string | null) => Promise<string | null>;

// Jeton de « Authorization: Bearer … », ou null.
export function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization")?.trim() ?? "");
  return match?.[1] ?? null;
}

// Demande à Supabase Auth à qui appartient le jeton. Auth vérifie la signature, l'expiration
// et la session (un compte déconnecté ou supprimé est refusé) : la fonction ne décode rien
// elle-même. La clé publique envoyée par l'app (en-tête apikey) passe la passerelle ; à
// défaut, celle de l'environnement.
export function authUserFinder(
  supabaseUrl: string,
  fallbackApiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): FindUser {
  const url = new URL("/auth/v1/user", supabaseUrl);
  return async (token, apiKey) => {
    const key = apiKey ?? fallbackApiKey;
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, ...(key ? { apikey: key } : {}) },
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AuthUnavailableError(response.status);
    }
    const user: unknown = await response.json();
    const id = (user as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  };
}

export class AuthUnavailableError extends Error {
  code: string;
  constructor(status: number) {
    super("Service d'authentification indisponible");
    this.name = "AuthUnavailableError";
    this.code = `auth_http_${status}`;
  }
}
