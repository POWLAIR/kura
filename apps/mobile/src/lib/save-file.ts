import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

// Fichiers remis à l'utilisateur. Sur mobile : écrit dans le cache de l'app, puis ouvre la
// feuille de partage du système, d'où il se range ou s'envoie où l'on veut.
// (Sur le web, save-file.web.ts déclenche un téléchargement.)
//
// L'export contient des données de santé : il ne reste pas dans le cache. Il est effacé
// après le partage, et tout export oublié (application fermée pendant le partage) l'est au
// prochain export et à la déconnexion.

const EXPORT_PREFIX = "kura-export-";

// Efface les exports encore présents dans le cache de l'app. Ne lève jamais.
export function clearExports(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.startsWith(EXPORT_PREFIX)) entry.delete();
    }
  } catch {
    // Cache illisible : rien à effacer de plus.
  }
}

export async function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  clearExports();
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  try {
    await file.write(content);
    // La promesse se résout quand l'app choisie a reçu le fichier.
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  } finally {
    try {
      file.delete();
    } catch {
      // Déjà effacé : rien à faire.
    }
  }
}
