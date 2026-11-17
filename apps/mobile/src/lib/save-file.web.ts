// Fichiers remis à l'utilisateur : sur le web, un téléchargement. Rien n'est gardé par
// l'app : le fichier n'existe que dans le dossier de téléchargement choisi.

export function clearExports(): void {
  // Rien à effacer côté web.
}

export function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return Promise.resolve();
}
