import type { McpServer } from "@modelcontextprotocol/server";
import { OPERATIONS } from "../../_shared/operations.ts";
import type { UserDb } from "../server.ts";
import { ok, userErrors } from "./result.ts";

// Tools d'inventaire (issue #6) : get_inventory, add_items, update_item, get_shopping_list.
// Ici, seulement ce que lit Claude (titres, descriptions) ; la logique est dans _shared,
// partagée avec l'API de l'app.

const { get_inventory, add_items, update_item, get_shopping_list } = OPERATIONS;

export function registerInventoryTools(server: McpServer, db: UserDb): void {
  server.registerTool(
    "get_inventory",
    {
      title: "Inventaire de la cuisine",
      description:
        "Liste les articles en stock : id, quantité (g, ml, piece) ou niveau (plein, moitie, presque_vide), emplacement, péremption, aliment de référence, low_stock si à racheter. Filtrable par catégorie, emplacement ou stock bas.",
      inputSchema: get_inventory.input,
      annotations: { readOnlyHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => get_inventory.run(tx, input)))),
  );

  server.registerTool(
    "add_items",
    {
      title: "Ajouter des courses",
      description:
        "Enregistre des articles achetés (ticket de caisse, courses dictées). Un article déjà en stock sous ce nom, ou lié au même aliment, est réapprovisionné ; sinon il est créé. Sans quantité, l'article est suivi en niveau (pot, bouteille, épice). Rien n'est deviné : chaque article ambigu est renvoyé dans « ambiguous » avec une raison, des candidats (food_ref_id) ou des articles existants (item_id) ; relancer seulement ceux-là avec la précision demandée. Les articles créés ou réapprovisionnés ne doivent pas être renvoyés. Donner une idempotency_key nouvelle à chaque enregistrement : un appel rejoué avec la même clé (« replayed ») ne réenregistre rien.",
      inputSchema: add_items.input,
    },
    (input) => userErrors(async () => ok(await db((tx) => add_items.run(tx, input)))),
  );

  server.registerTool(
    "update_item",
    {
      title: "Corriger un article",
      description:
        "Corrige un article de l'inventaire (id via get_inventory) : quantité restante, niveau, date de péremption, emplacement, seuil de rachat, nom, catégorie ou aliment de référence. Seuls les champs donnés changent ; null efface une date, un seuil ou l'aliment. Passer de la quantité au niveau (ou l'inverse) efface l'ancien suivi.",
      inputSchema: update_item.input,
      annotations: { idempotentHint: true },
    },
    (input) => userErrors(async () => ok(await db((tx) => update_item.run(tx, input)))),
  );

  server.registerTool(
    "get_shopping_list",
    {
      title: "Liste « À racheter »",
      description:
        "Articles au seuil de rachat ou en dessous (quantité ou niveau). Un article sans seuil de rachat n'y figure jamais : en fixer un avec update_item.",
      annotations: { readOnlyHint: true },
    },
    () => userErrors(async () => ok(await db((tx) => get_shopping_list.run(tx, {})))),
  );
}
