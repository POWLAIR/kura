import { useWindowDimensions } from "react-native";

// Au-delà de cette largeur (ordinateur, tablette à l'horizontale), les onglets passent
// en colonne à gauche et les écrans se mettent en colonnes (conception, « Écrans et
// parcours » : les mêmes écrans en colonnes sur desktop).
export const WIDE_MIN_WIDTH = 900;

export function useWideLayout(): boolean {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}
