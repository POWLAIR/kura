import { fold } from "./text.ts";

// Rapprochement d'un nom libre (« Œufs », « Clous de girofle ») avec food_ref.
// Prudent : un lien faux donnerait des valeurs nutritionnelles fausses, donc on ne
// lie que si un seul aliment correspond ; sinon on renvoie les candidats proches.

export type Food = { id: number; code: string; name: string };

export type FoodMatch =
  | { status: "matched"; food: Food; by: "nom" | "choix" }
  | { status: "unmatched"; candidates: Food[] }
  // Choix explicite : aucun aliment de la source ne correspond (sauce de marque…).
  | { status: "excluded" };

// Choix faits à la main : nom de l'article → code de l'aliment, ou null pour aucun.
export type FoodChoices = Record<string, string | null>;

// Mots outils, sans valeur pour départager des candidats.
const STOPWORDS = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "en",
  "et",
  "l",
  "la",
  "le",
  "les",
  "ou",
]);

// Singulier approximatif, appliqué des deux côtés : « Oeufs » = « Oeuf ».
export function normalizeFoodName(name: string): string {
  return fold(name)
    .split(" ")
    .map((word) => (word.length > 3 ? word.replace(/[sx]$/, "") : word))
    .join(" ");
}

type Indexed<T> = { value: T; full: string; head: string; lead: string; words: Set<string> };

// Les noms Ciqual suivent « Aliment, précision, précision » : la tête est l'aliment.
function indexed<T>(value: T, name: string): Indexed<T> {
  const full = normalizeFoodName(name);
  return {
    value,
    full,
    head: normalizeFoodName(name.split(",")[0] ?? ""),
    lead: full.split(" ")[0] ?? "",
    words: new Set(full.split(" ")),
  };
}

// Éléments partageant au moins un mot avec la requête (mots outils exclus), les plus
// proches d'abord. Le premier mot nomme l'aliment (« Sauce tomate », « Huile d'olive ») :
// il départage, puis le nom le plus court.
function rank<T>(query: string, entries: Indexed<T>[], max: number): T[] {
  const queryWords = query.split(" ").filter((w) => !STOPWORDS.has(w));
  return entries
    .map((e) => ({ e, shared: queryWords.filter((w) => e.words.has(w)).length }))
    .filter(({ shared }) => shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        Number(b.e.lead === queryWords[0]) - Number(a.e.lead === queryWords[0]) ||
        a.e.full.length - b.e.full.length,
    )
    .slice(0, max)
    .map(({ e }) => e.value);
}

export function createFoodMatcher(
  foods: Food[],
  { maxCandidates = 3 }: { maxCandidates?: number } = {},
): (query: string) => FoodMatch {
  const entries = foods.map((food) => indexed(food, food.name));
  return (query) => {
    const q = normalizeFoodName(query);
    const exact = entries.filter((e) => e.full === q);
    // Seul aliment de ce nom avant la virgule (« Cannelle, poudre »), et aucune variante qui
    // commence par ce nom : « Riz » reste ambigu (riz blanc, thaï, complet…).
    const sameHead = entries.filter((e) => e.head === q);
    const variants = entries.some((e) => e.head.startsWith(`${q} `));
    const unique = exact.length === 1 ? exact : sameHead.length === 1 && !variants ? sameHead : [];
    if (unique[0]) return { status: "matched", food: unique[0].value, by: "nom" };
    return { status: "unmatched", candidates: rank(q, entries, maxCandidates) };
  };
}

// Éléments au nom proche de la requête (articles de l'inventaire…), les plus proches d'abord.
export function similarByName<T extends { name: string }>(query: string, items: T[], max = 3): T[] {
  return rank(
    normalizeFoodName(query),
    items.map((item) => indexed(item, item.name)),
    max,
  );
}

// Rapproche chaque nom ; les choix manuels priment. Un choix qui ne vise aucun
// article ou aucun aliment connu est une erreur de saisie : on s'arrête.
export function matchFoods(
  names: string[],
  foods: Food[],
  choices: FoodChoices = {},
): Map<string, FoodMatch> {
  const byCode = new Map(foods.map((f) => [f.code, f]));
  for (const [name, code] of Object.entries(choices)) {
    if (!names.includes(name))
      throw new Error(`Choix pour « ${name} » : article absent de la page`);
    if (code !== null && !byCode.has(code)) {
      throw new Error(`Choix pour « ${name} » : code ${code} absent de food_ref`);
    }
  }

  const match = createFoodMatcher(foods);
  return new Map(
    names.map((name): [string, FoodMatch] => {
      const code = choices[name];
      if (code === undefined) return [name, match(name)];
      const food = code === null ? undefined : byCode.get(code);
      return [name, food ? { status: "matched", food, by: "choix" } : { status: "excluded" }];
    }),
  );
}
