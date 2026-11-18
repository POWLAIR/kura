import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GeneratedRecipes, RECIPE_SYSTEM_PROMPT } from "@kura/core";

// Appel à l'API Anthropic : seul le message préparé par recipePrompt (la demande et le stock)
// part, jamais de repas, de poids ni d'identifiant de l'utilisateur.

export type Generate = (prompt: string) => Promise<GeneratedRecipes>;

const MODEL = "claude-opus-5-5";

// Le modèle a refusé, ou n'a pas rendu le JSON attendu.
export class GenerationError extends Error {
  code: string;
  constructor(code: string) {
    super("Génération de recettes impossible");
    this.name = "GenerationError";
    this.code = code;
  }
}

export function anthropicGenerator(apiKey: string): Generate {
  // Deux nouvelles tentatives par défaut (429, 5xx, réseau), une minute au plus chacune.
  const client = new Anthropic({ apiKey, timeout: 60_000 });
  return async (prompt) => {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Refus d'un modèle : la requête est rejouée sur un modèle de repli, côté serveur.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(GeneratedRecipes) },
      system: RECIPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new GenerationError("model_refusal");
    if (response.stop_reason === "max_tokens") throw new GenerationError("model_max_tokens");
    if (!response.parsed_output) throw new GenerationError("model_invalid_output");
    return response.parsed_output;
  };
}
