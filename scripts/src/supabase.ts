import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@kura/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Variables du .env à la racine, ou du fichier désigné par KURA_ENV_FILE (ex.
// .env.production pour la base déployée). Celles déjà définies dans l'environnement priment.
export function loadEnv(): void {
  const chosen = process.env.KURA_ENV_FILE;
  const root = resolve(import.meta.dirname, "../..");
  const envFile = resolve(root, chosen ?? ".env");
  // Fichier demandé mais absent : surtout ne pas retomber sur la base locale, ou l'inverse.
  if (chosen && !existsSync(envFile)) throw new Error(`KURA_ENV_FILE introuvable : ${envFile}`);
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} requis (voir .env.example)`);
  return value;
}

// Client service_role : scripts locaux uniquement, jamais dans l'app.
export function createAdminClient(): SupabaseClient<Database> {
  // Toujours dire sur quelle base on travaille : locale ou déployée.
  console.log(`Supabase : ${new URL(requireEnv("SUPABASE_URL")).host}`);
  return createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false },
    },
  );
}

// Id Supabase Auth d'un compte, par son email. Usage solo : une page d'utilisateurs suffit.
export async function findUserId(
  supabase: SupabaseClient<Database>,
  email: string,
): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Lecture des utilisateurs : ${error.message}`);
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Aucun utilisateur ${email} dans Supabase Auth`);
  return user.id;
}
