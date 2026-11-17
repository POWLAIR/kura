import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json reste la configuration ; ce fichier n'ajoute que le sous-chemin du build web,
// donné au moment du build (KURA_WEB_BASE_URL=/kura pour GitHub Pages). Sans lui, l'app
// est servie à la racine, comme en développement.
export default ({ config }: ConfigContext): ExpoConfig => {
  // Même normalisation que normalizeBaseUrl (src/lib/pwa.ts) : « /kura », ou rien.
  const path = (process.env.KURA_WEB_BASE_URL ?? "").trim().replace(/^\/+|\/+$/g, "");
  const baseUrl = path === "" ? undefined : `/${path}`;
  return {
    ...config,
    name: config.name ?? "Kura",
    slug: config.slug ?? "kura",
    experiments: { ...config.experiments, ...(baseUrl ? { baseUrl } : {}) },
  };
};
