// Logs des Edge Functions : événements, identifiants et codes d'erreur uniquement.
// Jamais de contenu (repas, poids, séance, inventaire) ni de clé API : voir CLAUDE.md.
type LogValue = string | number | boolean | null;

export function log(event: string, fields: Record<string, LogValue> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

// Code Postgres (« 23505 ») ou nom de l'erreur ; jamais son message, qui peut contenir des valeurs.
export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
    if (error instanceof Error) return error.name;
  }
  return "unknown";
}
