import { recipeRequestText } from "@kura/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// Prompts MCP (issue #79) : des demandes prêtes à l'emploi, dans le menu du connecteur sur
// claude.ai et en commandes / dans Claude Code. Ils n'écrivent rien eux-mêmes : ils
// rédigent la demande et rappellent les tools à utiliser. Les arguments d'un prompt MCP sont
// toujours du texte.

function user(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

// « 30 », « 30 min » → 30 ; vide ou illisible → rien (on ne devine pas).
function positiveInt(value: string | undefined, max: number): number | undefined {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "what_to_eat",
    {
      title: "Qu'est-ce que je mange ?",
      description: "Trois recettes depuis le stock, ce qui périme bientôt d'abord.",
      argsSchema: z.object({
        max_minutes: z.string().optional().describe("Temps disponible, en minutes"),
        servings: z.string().optional().describe("Nombre de portions"),
        craving: z.string().optional().describe("Une envie, ex. « quelque chose d'asiatique »"),
      }),
    },
    ({ max_minutes, servings, craving }) => {
      const minutes = positiveInt(max_minutes, 600);
      const portions = positiveInt(servings, 12);
      const envie = craving?.trim().slice(0, 200);
      return user(
        recipeRequestText({
          ...(minutes && { max_minutes: minutes }),
          ...(portions && { servings: portions }),
          ...(envie && { craving: envie }),
        }),
      );
    },
  );

  server.registerPrompt(
    "put_away_groceries",
    {
      title: "Ranger mes courses",
      description: "Ajoute au stock ce qui vient d'être acheté.",
      argsSchema: z.object({
        groceries: z.string().optional().describe("Les courses, ex. « 1 kg de riz, 6 œufs »"),
      }),
    },
    ({ groceries }) => {
      const list = groceries?.trim();
      return user(
        [
          "Je range mes courses.",
          list ? `Voici ce que j'ai acheté : ${list}.` : "Je vais te dicter ce que j'ai acheté.",
          "Ajoute-le à mon stock Kura avec add_items, avec l'emplacement et la péremption si je les donne, et demande-moi seulement ce qui est ambigu.",
        ].join(" "),
      );
    },
  );

  server.registerPrompt(
    "weekly_summary",
    {
      title: "Résumé de la semaine",
      description: "Repas, séances et pesées des sept derniers jours.",
    },
    () =>
      user(
        "Fais-moi le résumé de ma semaine dans Kura avec get_summary (période : semaine) : repas, séances et pesées. Reste factuel, sans commentaire sur le poids, les quantités mangées ou les calories.",
      ),
  );
}
