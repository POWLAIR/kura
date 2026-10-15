// PostToolUse : formate avec Biome le fichier que Claude vient d'écrire.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const file = JSON.parse(input).tool_input?.file_path;
if (file && /\.(ts|tsx|js|jsx|mjs|json|jsonc|css)$/.test(file)) {
  try {
    execFileSync("pnpm", ["exec", "biome", "check", "--write", "--no-errors-on-unmatched", file], {
      stdio: "ignore",
    });
  } catch {
    // Les erreurs de lint restantes remontent via `pnpm check`, pas ici.
  }
}
