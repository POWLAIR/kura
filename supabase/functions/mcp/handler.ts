import { apiKeyFromHeaders, hashApiKey } from "@kura/core";
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  localhostAllowedOrigins,
  type McpServer,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import type { Caller } from "./db.ts";
import { errorCode, log } from "./log.ts";

export type HandlerDeps = {
  findCaller: (keyHash: string) => Promise<Caller | null>;
  buildServer: (caller: Caller) => McpServer;
};

// Streamable HTTP sans état : clé API en « Authorization: Bearer kura_… » ou dans un en-tête
// X-API-Key (et apparentés, pour le connecteur claude.ai), vérifiée
// par son hash avant tout traitement MCP. Voir docs/mcp.md.
export function createHandler({ findCaller, buildServer }: HandlerDeps) {
  const mcp = createMcpHandler(({ authInfo }) => buildServer(callerOf(authInfo)), {
    onerror: (error) => log("mcp_error", { code: errorCode(error) }),
  });

  return async (request: Request): Promise<Response> => {
    // Navigateur : seul un outil local (inspecteur MCP) est accepté.
    const rejected = originValidationResponse(request, localhostAllowedOrigins());
    if (rejected) return rejected;

    const key = apiKeyFromHeaders(request.headers);
    let caller: Caller | null = null;
    try {
      caller = key ? await findCaller(await hashApiKey(key)) : null;
    } catch (error) {
      // Base injoignable : surtout pas un 401, le client croirait sa clé révoquée.
      log("auth_unavailable", { code: errorCode(error) });
      return new Response(null, { status: 503, headers: { "retry-after": "5" } });
    }
    if (!caller) {
      log("auth_refused", { reason: key ? "unknown_or_revoked" : "missing_or_malformed" });
      // En-tête WWW-Authenticate : ASCII uniquement, d'où l'absence d'accents.
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "Cle API absente, invalide ou revoquee"),
      );
    }

    try {
      return await mcp.fetch(request, { authInfo: authInfoOf(caller) });
    } catch (error) {
      log("mcp_error", { code: errorCode(error) });
      return new Response(null, { status: 500 });
    }
  };
}

// L'appelant voyage dans authInfo jusqu'à la fabrique de serveur et aux tools
// (ctx.http.authInfo). Jamais la clé en clair : le serveur n'en a plus besoin.
function authInfoOf(caller: Caller): AuthInfo {
  return { token: "", clientId: `api_key:${caller.keyId}`, scopes: [], extra: { ...caller } };
}

function callerOf(authInfo: AuthInfo | undefined): Caller {
  const extra = authInfo?.extra;
  if (typeof extra?.keyId !== "number" || typeof extra.userId !== "string") {
    throw new Error("Appelant non authentifié");
  }
  return { keyId: extra.keyId, userId: extra.userId };
}
