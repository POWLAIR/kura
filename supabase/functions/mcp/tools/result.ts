import type { CallToolResult } from "@modelcontextprotocol/server";
import { userErrorMessage } from "../../_shared/errors.ts";

// Réponses des tools : JSON compact pour Claude, erreurs de saisie lisibles.

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// Les erreurs de saisie (TypeScript ou SQL attendues) reviennent à Claude comme erreur du
// tool. Les autres remontent au handler (500, code loggé).
export async function userErrors(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = userErrorMessage(error);
    if (message === null) throw error;
    return fail(message);
  }
}
