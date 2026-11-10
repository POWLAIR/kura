// Configuration publique de l'app. Seules les variables EXPO_PUBLIC_* sont embarquées :
// l'URL du projet et la clé publique, jamais la clé secrète ni service_role.

export type Env = { supabaseUrl: string; supabaseKey: string };

type PublicVars = {
  EXPO_PUBLIC_SUPABASE_URL?: string | undefined;
  EXPO_PUBLIC_SUPABASE_KEY?: string | undefined;
};

// Rôle porté par une clé d'ancienne génération (un JWT), ou null pour une clé sb_….
function legacyKeyRole(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const role: unknown = JSON.parse(json).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function readEnv(vars: PublicVars): Env {
  const supabaseUrl = vars.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = vars.EXPO_PUBLIC_SUPABASE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_KEY sont à définir (voir docs/app.md)",
    );
  }
  if (supabaseKey.startsWith("sb_secret_") || legacyKeyRole(supabaseKey) === "service_role") {
    throw new Error("EXPO_PUBLIC_SUPABASE_KEY doit être la clé publique, jamais la clé secrète");
  }
  return { supabaseUrl, supabaseKey };
}
