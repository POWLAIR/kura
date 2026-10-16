import type { CallToolResult } from "@modelcontextprotocol/server";

// Réponses des tools : JSON compact pour Claude, erreurs de saisie lisibles.

// Erreurs SQL attendues (saisie refusée, article introuvable…) : renvoyées à Claude telles
// quelles. Les autres remontent au handler (500, code loggé).
const USER_ERRORS = new Set(["22023", "22P02", "23503", "23514", "P0002"]);

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// Saisie refusée côté TypeScript, renvoyée à Claude comme les erreurs SQL attendues.
export class InputError extends Error {}

export async function userErrors(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InputError) return fail(error.message);
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && USER_ERRORS.has(code) && error instanceof Error) {
      return fail(error.message);
    }
    throw error;
  }
}

// Objet sans ses champs vides (null ou undefined) : réponses plus courtes.
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}
