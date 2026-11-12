// Erreurs des Edge Functions de l'app, sans dépendance à React Native (testé avec Vitest).

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const NETWORK_MESSAGE = "Connexion impossible pour l'instant. Réessaie dans un moment.";

// Corps d'erreur d'une fonction ({ error: { code, message } }) → ApiError. Un corps inattendu
// donne un message générique : rien de technique n'est montré à l'utilisateur.
export function apiErrorFrom(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (typeof error?.code === "string" && typeof error.message === "string") {
    return new ApiError(error.code, error.message, status);
  }
  return new ApiError("unexpected", NETWORK_MESSAGE, status);
}

// Message à afficher pour une erreur quelconque.
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : NETWORK_MESSAGE;
}
