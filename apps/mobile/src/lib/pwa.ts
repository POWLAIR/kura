// Version web installable (PWA) : manifeste et balises ajoutées au build web d'Expo par
// scripts/finish-web-export.mts. Pas de service worker : l'app a besoin du réseau pour
// joindre Supabase, et un cache hors ligne servirait des versions périmées.

export type ManifestOptions = { name: string; description: string; baseUrl: string };

// Fonds clair et sombre de theme.ts.
export const PWA_COLORS = { light: "#F6F1E7", dark: "#15130F" } as const;

// « /kura/ » ou « kura » → « /kura » ; « / » ou rien → « » (site à la racine du domaine).
export function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

export function webManifest({ name, description, baseUrl }: ManifestOptions) {
  const root = `${baseUrl}/`;
  return {
    id: root,
    name,
    short_name: name,
    description,
    lang: "fr",
    start_url: root,
    scope: root,
    display: "standalone",
    background_color: PWA_COLORS.light,
    theme_color: PWA_COLORS.light,
    icons: [
      { src: `${baseUrl}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${baseUrl}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      {
        src: `${baseUrl}/icons/maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

const MARKER = 'rel="manifest"';

// Ajoute le manifeste, l'icône iOS et la couleur de la barre du navigateur dans le <head>.
export function addPwaTags(html: string, baseUrl: string): string {
  if (html.includes(MARKER)) return html;
  if (!html.includes("</head>")) throw new Error("index.html sans </head>");
  const tags = [
    `<link ${MARKER} href="${baseUrl}/manifest.webmanifest">`,
    `<link rel="apple-touch-icon" href="${baseUrl}/icons/apple-touch-icon.png">`,
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${PWA_COLORS.light}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${PWA_COLORS.dark}">`,
  ].join("\n");
  return html.replace("</head>", `${tags}\n</head>`);
}
