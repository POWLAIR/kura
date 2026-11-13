import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

// Remet un fichier texte à l'utilisateur. Sur mobile : écrit dans le cache de l'app, puis
// ouvre la feuille de partage du système, d'où il se range ou s'envoie où l'on veut.
// (Sur le web, save-file.web.ts déclenche un téléchargement.)
export async function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}
