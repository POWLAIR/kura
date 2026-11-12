// Erreurs de saisie, communes aux tools MCP et à l'API de l'app.

// Saisie refusée côté TypeScript, renvoyée à l'appelant comme les erreurs SQL attendues.
export class InputError extends Error {}

// Erreurs SQL attendues (saisie refusée, article introuvable…) : leur message, en français,
// est écrit par nos fonctions SQL pour l'appelant. Les autres erreurs restent internes.
const USER_ERRORS = new Set(["22023", "22P02", "23503", "23514", "P0002"]);

// Message à renvoyer à l'appelant, ou null si l'erreur est interne (500, code loggé).
export function userErrorMessage(error: unknown): string | null {
  if (error instanceof InputError) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && USER_ERRORS.has(code) && error instanceof Error) {
    return error.message;
  }
  return null;
}

// Objet sans ses champs vides (null ou undefined) : réponses plus courtes.
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}
