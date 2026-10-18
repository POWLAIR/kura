// Clé API du connecteur MCP (phase 1, docs/conception.md « Serveur MCP »).
// Seul le hash SHA-256 est stocké (api_key.key_hash). La clé en clair n'est montrée
// qu'une fois, à la création, et n'est jamais stockée ni loggée.
// Web Crypto uniquement : même code en Node (scripts) et en Deno (Edge Functions).

export const API_KEY_PREFIX = "kura_";
// Début de clé gardé en clair (api_key.key_prefix) pour la reconnaître dans les réglages.
export const API_KEY_VISIBLE_LENGTH = 12;

// 32 octets aléatoires en base64url : 43 caractères après le préfixe.
const API_KEY_PATTERN = /^kura_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return API_KEY_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// « Authorization: Bearer kura_… » → la clé ; null si l'en-tête est absent ou mal formé.
export function apiKeyFromHeader(header: string | null): string | null {
  const key = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "")?.[1];
  return key && isApiKey(key) ? key : null;
}

// En-têtes de clé API proposés par les clients qui n'envoient pas Authorization (le
// formulaire de connecteur claude.ai n'offre qu'une liste fixe d'en-têtes X-…).
export const API_KEY_HEADERS = [
  "x-api-key",
  "x-auth-token",
  "x-auth-api-key",
  "x-auth-key",
  "x-api-token",
  "x-access-token",
  "api-key",
] as const;

// Clé lue dans Authorization (Bearer), sinon dans l'un des en-têtes X-… (clé seule ou
// précédée de Bearer). Le format est vérifié dans tous les cas.
export function apiKeyFromHeaders(headers: { get(name: string): string | null }): string | null {
  const bearer = apiKeyFromHeader(headers.get("authorization"));
  if (bearer) return bearer;
  for (const name of API_KEY_HEADERS) {
    const value = headers.get(name)?.trim();
    if (!value) continue;
    const key = value.replace(/^Bearer\s+/i, "");
    if (isApiKey(key)) return key;
  }
  return null;
}
