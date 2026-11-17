// Termine le build web (`expo export --platform web`) pour en faire une PWA :
// manifeste, balises du <head>, et 404.html pour GitHub Pages.
//
//   KURA_WEB_BASE_URL=/kura node scripts/finish-web-export.mts [dist]
//
// GitHub Pages ne connaît pas les routes de l'app : une URL comme /kura/journal y
// renvoie sa page 404. Une copie de index.html sous ce nom laisse Expo Router l'ouvrir.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addPwaTags, normalizeBaseUrl, webManifest } from "../src/lib/pwa.ts";

const dist = process.argv[2] ?? "dist";
const baseUrl = normalizeBaseUrl(process.env.KURA_WEB_BASE_URL);

const manifest = webManifest({
  name: "Kura",
  description: "Inventaire de cuisine, recettes et journal.",
  baseUrl,
});
await writeFile(join(dist, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);

const indexPath = join(dist, "index.html");
await writeFile(indexPath, addPwaTags(await readFile(indexPath, "utf8"), baseUrl));
await copyFile(indexPath, join(dist, "404.html"));

console.log(`PWA prête dans ${dist} (sous-chemin : ${baseUrl || "/"})`);
