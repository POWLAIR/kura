import { fold } from "./text";

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

const MAX_CANDIDATES = 3;
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

type Entry = { food: Food; full: string; head: string; lead: string; words: Set<string> };

export function createFoodMatcher(foods: Food[]): (query: string) => FoodMatch {
  // Les noms Ciqual suivent « Aliment, précision, précision » : la tête est l'aliment.
  const entries: Entry[] = foods.map((food) => {
    const full = normalizeFoodName(food.name);
    return {
      food,
      full,
      head: normalizeFoodName(food.name.split(",")[0] ?? ""),
      lead: full.split(" ")[0] ?? "",
      words: new Set(full.split(" ")),
    };
  });

  return (query) => {
    const q = normalizeFoodName(query);
    const exact = entries.filter((e) => e.full === q);
    const sameHead = entries.filter((e) => e.head === q);
    const unique = exact.length === 1 ? exact : sameHead.length === 1 ? sameHead : [];
    if (unique[0]) return { status: "matched", food: unique[0].food, by: "nom" };

    // Le premier mot nomme l'aliment (« Sauce tomate », « Huile d'olive ») : il départage.
    const queryWords = q.split(" ").filter((w) => !STOPWORDS.has(w));
    const candidates = entries
      .map((e) => ({ e, shared: queryWords.filter((w) => e.words.has(w)).length }))
      .filter(({ shared }) => shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared ||
          Number(b.e.lead === queryWords[0]) - Number(a.e.lead === queryWords[0]) ||
          a.e.food.name.length - b.e.food.name.length,
      )
      .slice(0, MAX_CANDIDATES)
      .map(({ e }) => e.food);
    return { status: "unmatched", candidates };
  };
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
