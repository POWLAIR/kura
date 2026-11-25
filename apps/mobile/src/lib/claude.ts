// Nouvelle conversation Claude avec la demande déjà écrite (issue #79). Sur le web, un onglet
// claude.ai ; sur Android, l'app Claude si elle prend en charge le lien, sinon le navigateur.
// Claude y retrouve Kura par le connecteur MCP de l'utilisateur.
export const CLAUDE_NEW_CHAT = "https://claude.ai/new";

export function claudeChatUrl(text: string): string {
  return `${CLAUDE_NEW_CHAT}?q=${encodeURIComponent(text)}`;
}
