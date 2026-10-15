import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "@kura/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Variables du .env à la racine ; celles déjà définies dans l'environnement priment.
export function loadEnv(): void {
  const envFile = resolve(import.meta.dirname, "../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} requis (voir .env.example)`);
  return value;
}

// Client service_role : scripts locaux uniquement, jamais dans l'app.
export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false },
    },
  );
}
