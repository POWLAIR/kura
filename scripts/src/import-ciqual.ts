// Import ponctuel de la table Ciqual dans food_ref (issue #2).
//
//   pnpm import:ciqual <dossier> [--dry-run]
//
// <dossier> contient les fichiers XML téléchargés depuis
// https://doi.org/10.57745/RDMHWY : alim_*.xml, const_*.xml, compo_*.xml.
// Idempotent : upsert sur (source, code). Les colonnes absentes du payload
// (piece_weight_g, saisi plus tard) ne sont pas écrasées.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "@kura/core";
import { createClient } from "@supabase/supabase-js";
import { type FoodRefRow, parseCiqual } from "./ciqual";

const BATCH_SIZE = 500;

function findFile(dir: string, prefix: string): string {
  const matches = readdirSync(dir).filter((f) => f.startsWith(`${prefix}_`) && f.endsWith(".xml"));
  if (matches.length !== 1) {
    throw new Error(
      `Attendu un seul fichier ${prefix}_*.xml dans ${dir}, trouvé ${matches.length}`,
    );
  }
  return readFileSync(join(dir, matches[0] as string), "utf8");
}

async function upsert(rows: FoodRefRow[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (voir .env.example)");
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("food_ref").upsert(batch, { onConflict: "source,code" });
    if (error) throw new Error(`Upsert food_ref (lot ${i / BATCH_SIZE + 1}) : ${error.message}`);
    console.log(`  ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirArg = args.find((a) => !a.startsWith("--"));
  if (!dirArg) {
    console.error("Usage : pnpm import:ciqual <dossier des XML Ciqual> [--dry-run]");
    process.exit(1);
  }

  // pnpm lance le script depuis scripts/ : on résout le chemin depuis le dossier d'appel.
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dirArg);
  const rows = parseCiqual({
    alim: findFile(dir, "alim"),
    const: findFile(dir, "const"),
    compo: findFile(dir, "compo"),
  });

  const missingEnergy = rows.filter((r) => r.energy_kcal === null).length;
  console.log(`${rows.length} aliments lus, dont ${missingEnergy} sans énergie renseignée.`);

  if (dryRun) {
    console.log("--dry-run : rien n'est écrit.");
    return;
  }

  const envFile = resolve(import.meta.dirname, "../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  await upsert(rows);
  console.log("Import terminé.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
