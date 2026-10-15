// Forme comparable d'un texte libre : minuscules, sans accents ni ligatures,
// ponctuation et emojis remplacés par des espaces.
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
