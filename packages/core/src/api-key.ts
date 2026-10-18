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

type HeaderBag = {
  get(name: string): string | null;
  forEach(callback: (value: string, name: string) => void): void;
};

// Valeur d'en-tête → clé, qu'elle soit seule ou précédée de « Bearer ».
function keyFromValue(value: string): string | null {
  const key = value.trim().replace(/^Bearer\s+/i, "");
  return isApiKey(key) ? key : null;
}

// Clé lue dans Authorization, sinon dans n'importe quel en-tête dont la valeur a le format
// d'une clé : les clients n'imposent pas tous le même nom (le connecteur claude.ai n'offre
// qu'une liste fixe d'en-têtes X-…). Le nom ne compte pas, la clé est vérifiée par son hash.
export function apiKeyFromHeaders(headers: HeaderBag): string | null {
  const bearer = apiKeyFromHeader(headers.get("authorization"));
  if (bearer) return bearer;
  let found: string | null = null;
  headers.forEach((value) => {
    found ??= keyFromValue(value);
  });
  return found;
}

// Pour les logs d'un refus : nom des en-têtes d'authentification reçus, avec seulement la
// longueur de leur valeur et si elle commence par « kura_ ». Jamais la valeur elle-même.
export function describeCredentialHeaders(headers: HeaderBag): string {
  const seen: string[] = [];
  headers.forEach((value, name) => {
    if (!/auth|key|token/i.test(name)) return;
    const bare = value.trim().replace(/^Bearer\s+/i, "");
    seen.push(`${name}(${bare.length}${bare.startsWith("kura_") ? ",kura" : ""})`);
  });
  return seen.join(" ") || "aucun";
}
