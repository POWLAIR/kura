// CORS des fonctions appelées par l'app (api, off-product). L'app Android n'envoie pas d'en-tête Origin ; une page web n'est
// acceptée que depuis l'app web (KURA_APP_ORIGINS) ou depuis localhost, pour le développement.

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// « https://a.example, https://b.example » → origines sans barre finale.
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

export function isAllowedOrigin(origin: string, appOrigins: string[]): boolean {
  return LOCAL_ORIGIN.test(origin) || appOrigins.includes(origin);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
