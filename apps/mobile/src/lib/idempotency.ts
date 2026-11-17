// Clé d'idempotence d'un enregistrement : unique par saisie, réutilisée si l'envoi est rejoué
// (réseau coupé, double appui). Elle n'a pas besoin d'être imprévisible, seulement unique.
export function newIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
