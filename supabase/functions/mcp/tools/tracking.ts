import type { McpServer } from "@modelcontextprotocol/server";
import { OPERATIONS } from "../../_shared/operations.ts";
import type { UserDb } from "../server.ts";
import { ok, userErrors } from "./result.ts";

// Tools de suivi (issue #8) : log_meal, log_workout, log_weight, get_summary ;
// set_food_conversion (issue #20) ; delete_entry, update_workout, update_weight (issue #22).
// Ici, seulement ce que lit Claude (titres, descriptions) ; la logique est dans _shared,
// partagée avec l'API de l'app.

const NEUTRAL =
  "Présenter les chiffres tels quels : aucun commentaire sur le poids, les quantités mangées ou les calories, aucun objectif.";

export function registerTrackingTools(server: McpServer, db: UserDb): void {
  server.registerTool(
    "log_meal",
    {
      title: "Enregistrer un repas",
      description:
        "Enregistre un repas hors recette : un libellé et la liste des aliments avec la quantité dans l'unité dite (g, kg, ml, cl, l, piece), sans convertir soi-même en grammes ni estimer de valeurs nutritionnelles. Le serveur rapproche chaque aliment de Ciqual et calcule les totaux ; si un aliment est ambigu, rien n'est enregistré et les candidats sont renvoyés. Une pièce sans poids ou un volume sans densité rendent le repas « valeurs partielles » : missing_conversions liste les valeurs à demander à l'utilisateur (voir set_food_conversion). idempotency_key unique par repas.",
      inputSchema: OPERATIONS.log_meal.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.log_meal.run(tx, input)))),
  );

  server.registerTool(
    "set_food_conversion",
    {
      title: "Poids d'une pièce ou densité d'un aliment",
      description:
        "Enregistre le poids d'une pièce (g) ou la densité (g/ml) d'un aliment, tels que l'utilisateur les a donnés : pesée, emballage. Ne jamais les estimer ni les proposer soi-même ; les demander quand log_meal renvoie missing_conversions. La valeur sert aux prochains repas et recalcule les repas déjà saisis avec cet aliment en pièces ou en ml (meals_updated). Un champ absent est gardé, null le retire.",
      inputSchema: OPERATIONS.set_food_conversion.input,
    },
    (input) =>
      userErrors(async () => ok(await db((tx) => OPERATIONS.set_food_conversion.run(tx, input)))),
  );

  server.registerTool(
    "log_workout",
    {
      title: "Enregistrer une séance",
      description:
        "Enregistre une séance de sport : type, durée en minutes, intensité ressentie de 1 à 5, date-heure. idempotency_key unique par séance.",
      inputSchema: OPERATIONS.log_workout.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.log_workout.run(tx, input)))),
  );

  server.registerTool(
    "log_weight",
    {
      title: "Enregistrer une pesée",
      description: `Enregistre une pesée en kg. idempotency_key unique par pesée. ${NEUTRAL}`,
      inputSchema: OPERATIONS.log_weight.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.log_weight.run(tx, input)))),
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Supprimer un repas, une séance ou une pesée",
      description:
        "Supprime un repas (avec ses aliments), une séance ou une pesée, par son id (get_summary d'un jour). Toujours confirmer avec l'utilisateur avant d'appeler. Pour corriger un repas : le supprimer puis le ressaisir avec log_meal et une nouvelle idempotency_key. Le stock n'est pas modifié : le corriger avec update_item si besoin. La clé d'idempotence de l'entrée supprimée est libérée : ne jamais rejouer l'ancien appel log_*.",
      inputSchema: OPERATIONS.delete_entry.input,
      annotations: { destructiveHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.delete_entry.run(tx, input)))),
  );

  server.registerTool(
    "update_workout",
    {
      title: "Corriger une séance",
      description:
        "Corrige une séance par son id (get_summary d'un jour) : type, durée, intensité, notes, début. Un champ absent est gardé ; null efface l'intensité ou les notes.",
      inputSchema: OPERATIONS.update_workout.input,
    },
    (input) =>
      userErrors(async () => ok(await db((tx) => OPERATIONS.update_workout.run(tx, input)))),
  );

  server.registerTool(
    "update_weight",
    {
      title: "Corriger une pesée",
      description: `Corrige une pesée par son id (get_summary d'un jour) : poids en kg, date-heure. ${NEUTRAL}`,
      inputSchema: OPERATIONS.update_weight.input,
    },
    (input) =>
      userErrors(async () => ok(await db((tx) => OPERATIONS.update_weight.run(tx, input)))),
  );

  server.registerTool(
    "get_summary",
    {
      title: "Résumé du jour ou de la semaine",
      description: `Résumé d'un jour ou d'une semaine (lundi-dimanche, heure de Paris) : totaux nutritionnels principaux depuis Ciqual, repas, séances, pesées (moyenne sur la semaine). incomplete liste les valeurs dont le total est un minimum ; partial_values signale des aliments non comptés. Une valeur absente est « non renseignée », jamais 0. Pour un jour, chaque repas, séance et pesée a son id (delete_entry, update_workout, update_weight). ${NEUTRAL}`,
      inputSchema: OPERATIONS.get_summary.input,
      annotations: { readOnlyHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => OPERATIONS.get_summary.run(tx, input)))),
  );
}
