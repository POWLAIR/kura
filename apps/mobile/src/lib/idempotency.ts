// Clé d'idempotence d'un enregistrement : unique par saisie, réutilisée si l'envoi est rejoué
// (réseau coupé, double appui). Elle n'a pas besoin d'être imprévisible, seulement unique.
export function newIdempotencyKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

// Clés d'un écran de saisie : la même tant que le contenu envoyé est le même (un envoi
// rejoué après une coupure ne crée pas de doublon), une nouvelle dès qu'il change (une
// saisie corrigée après un échec n'est pas prise pour l'ancienne).
export type Keyring = { keyFor: (payload: unknown) => string; reset: () => void };

export function createKeyring(prefix: string): Keyring {
  let last: { signature: string; key: string } | null = null;
  return {
    keyFor(payload) {
      const signature = JSON.stringify(payload);
      if (last?.signature !== signature) last = { signature, key: newIdempotencyKey(prefix) };
      return last.key;
    },
    reset() {
      last = null;
    },
  };
}
