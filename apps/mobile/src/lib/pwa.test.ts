import { describe, expect, it } from "vitest";
import { addPwaTags, normalizeBaseUrl, webManifest } from "./pwa";

describe("normalizeBaseUrl", () => {
  it("garde un seul / devant et aucun derrière", () => {
    expect(normalizeBaseUrl("/kura/")).toBe("/kura");
    expect(normalizeBaseUrl("kura")).toBe("/kura");
    expect(normalizeBaseUrl(" /kura ")).toBe("/kura");
  });

  it("renvoie une chaîne vide pour la racine du domaine", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("/")).toBe("");
  });
});

describe("webManifest", () => {
  it("place le point d'entrée, la portée et les icônes sous le sous-chemin", () => {
    const manifest = webManifest({ name: "Kura", description: "d", baseUrl: "/kura" });
    expect(manifest.start_url).toBe("/kura/");
    expect(manifest.scope).toBe("/kura/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/kura/icons/icon-192.png",
      "/kura/icons/icon-512.png",
      "/kura/icons/maskable-512.png",
    ]);
  });

  it("fonctionne à la racine du domaine", () => {
    const manifest = webManifest({ name: "Kura", description: "d", baseUrl: "" });
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons[0]?.src).toBe("/icons/icon-192.png");
  });
});

describe("addPwaTags", () => {
  const html = "<html><head><title>Kura</title></head><body></body></html>";

  it("ajoute le manifeste et l'icône iOS dans le head", () => {
    const result = addPwaTags(html, "/kura");
    expect(result).toContain('<link rel="manifest" href="/kura/manifest.webmanifest">');
    expect(result).toContain('href="/kura/icons/apple-touch-icon.png"');
    expect(result.indexOf("manifest")).toBeLessThan(result.indexOf("</head>"));
  });

  it("ne les ajoute qu'une fois", () => {
    const once = addPwaTags(html, "/kura");
    expect(addPwaTags(once, "/kura")).toBe(once);
  });

  it("refuse une page sans head", () => {
    expect(() => addPwaTags("<body></body>", "")).toThrow();
  });
});
