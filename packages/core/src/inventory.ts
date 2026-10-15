import type { z } from "zod";
import type { StockLevel } from "./schemas";

// stock_movement.delta d'un article suivi en niveau (sans quantité chiffrée) :
// fraction d'un contenant plein. Un pot acheté plein puis fini en deux fois :
// achat +1, cuisine -0,5, cuisine -0,5.
export const STOCK_LEVEL_FRACTION = {
  plein: 1,
  moitie: 0.5,
  presque_vide: 0.25,
} as const satisfies Record<z.infer<typeof StockLevel>, number>;
