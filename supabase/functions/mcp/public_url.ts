// Adresse du projet vue par les clients OAuth (Claude), pour la ressource et le serveur
// d'autorisation annoncés par le serveur MCP (voir docs/mcp.md).

// En local, les fonctions tournent dans un conteneur et reçoivent l'adresse interne de la
// passerelle ; Claude, lui, passe par le port exposé sur l'ordinateur ([api] port de
// supabase/config.toml). En ligne, SUPABASE_URL est déjà l'adresse publique.
const LOCAL_GATEWAY = "http://kong:8000";
const LOCAL_PUBLIC = "http://127.0.0.1:54321";

export function publicBaseUrl(supabaseUrl: string): string {
  const url = supabaseUrl.replace(/\/$/, "");
  return url === LOCAL_GATEWAY ? LOCAL_PUBLIC : url;
}
