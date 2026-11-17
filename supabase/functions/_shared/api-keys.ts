import {
  API_KEY_VISIBLE_LENGTH,
  type ApiKeyView,
  type CreateApiKeyInput,
  type CreatedApiKey,
  generateApiKey,
  hashApiKey,
  type RevokeApiKeyInput,
} from "@kura/core";
import type { Tx } from "./db.ts";
import { InputError } from "./errors.ts";

// Clés du connecteur Claude, gérées depuis les réglages de l'app (issue #30). Réservées à
// l'API de l'app : ce ne sont pas des tools MCP, une clé ne crée pas d'autres clés.
// La clé en clair n'existe que dans la réponse de create_api_key : seul son hash SHA-256
// est écrit en base, et rien n'en est loggé.

const VIEW = ["id", "label", "key_prefix", "created_at", "last_used_at", "revoked_at"] as const;

export async function createApiKey(tx: Tx, { label }: CreateApiKeyInput): Promise<CreatedApiKey> {
  const secret = generateApiKey();
  const [key] = await tx<ApiKeyView[]>`
    insert into public.api_key (label, key_prefix, key_hash)
    values (${label}, ${secret.slice(0, API_KEY_VISIBLE_LENGTH)}, ${await hashApiKey(secret)})
    returning ${tx(VIEW)}`;
  if (!key) throw new Error("create_api_key sans résultat");
  return { key, secret };
}

// Une clé révoquée est refusée par le serveur MCP dès la requête suivante. La ligne est
// gardée pour l'historique ; elle ne peut pas être réactivée.
export async function revokeApiKey(tx: Tx, { id }: RevokeApiKeyInput) {
  const [revoked] = await tx<ApiKeyView[]>`
    update public.api_key set revoked_at = now()
    where id = ${id} and revoked_at is null
    returning ${tx(VIEW)}`;
  if (!revoked) throw new InputError("Clé introuvable ou déjà révoquée");
  return { revoked };
}
