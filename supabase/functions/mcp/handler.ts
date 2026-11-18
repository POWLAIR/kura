import { apiKeyFromHeaders, describeCredentialHeaders, hashApiKey } from "@kura/core";
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
import type { Caller } from "../_shared/db.ts";
import { errorCode, log } from "../_shared/log.ts";
import { bearerToken } from "../_shared/session.ts";

// L'utilisateur au nom de qui le serveur agit : par une clé API (Claude Code, scripts,
// inspecteur), ou par un jeton OAuth de Supabase Auth (connecteur claude.ai). Dans les deux
// cas, tout passe ensuite par asUser : la RLS de cet utilisateur.
export type McpCaller =
  | { via: "api_key"; userId: string; keyId: number }
  | { via: "oauth"; userId: string };

export type OAuthDeps = {
  // Id de l'utilisateur du jeton, null s'il est refusé ; lève si Auth ne répond pas.
  findUser: (token: string) => Promise<string | null>;
  // URL publique de la fonction (la ressource protégée) et du serveur d'autorisation.
  resource: string;
  authorizationServer: string;
};

export type HandlerDeps = {
  findCaller: (keyHash: string) => Promise<Caller | null>;
  buildServer: (caller: McpCaller) => McpServer;
  oauth?: OAuthDeps;
};

const METADATA_PATHS = ["/oauth-protected-resource", "/.well-known/oauth-protected-resource"];

// Métadonnées de ressource protégée (RFC 9728) : où obtenir un jeton pour ce serveur.
function metadataResponse(request: Request, oauth: OAuthDeps): Response {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return Response.json(
    {
      resource: oauth.resource,
      authorization_servers: [oauth.authorizationServer],
      bearer_methods_supported: ["header"],
      resource_name: "Kura",
    },
    { headers: { ...cors, "cache-control": "max-age=3600" } },
  );
}

// Streamable HTTP sans état. Deux façons de s'authentifier, vérifiées avant tout
// traitement MCP (voir docs/mcp.md) :
// - clé API kura_… en « Authorization: Bearer », ou dans n'importe quel en-tête ;
// - jeton OAuth 2.1 de Supabase Auth en « Authorization: Bearer » (connecteur claude.ai).
export function createHandler({ findCaller, buildServer, oauth }: HandlerDeps) {
  const mcp = createMcpHandler(({ authInfo }) => buildServer(callerOf(authInfo)), {
    onerror: (error) => log("mcp_error", { code: errorCode(error) }),
  });

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (oauth && METADATA_PATHS.some((suffix) => path.endsWith(suffix))) {
      return metadataResponse(request, oauth);
    }

    // Navigateur : seul un outil local (inspecteur MCP) est accepté.
    const rejected = originValidationResponse(request, localhostAllowedOrigins());
    if (rejected) return rejected;

    const key = apiKeyFromHeaders(request.headers);
    // Une clé kura_ mal formée n'est pas un jeton OAuth : inutile d'interroger Auth.
    const bearer = key ? null : bearerToken(request.headers);
    const token = bearer?.startsWith("kura_") ? null : bearer;
    let caller: McpCaller | null = null;
    try {
      if (key) {
        const found = await findCaller(await hashApiKey(key));
        caller = found && { via: "api_key", ...found };
      } else if (token && oauth) {
        const userId = await oauth.findUser(token);
        caller = userId ? { via: "oauth", userId } : null;
      }
    } catch (error) {
      // Base injoignable : surtout pas un 401, le client croirait sa clé révoquée.
      log("auth_unavailable", { code: errorCode(error) });
      return new Response(null, { status: 503, headers: { "retry-after": "5" } });
    }
    if (!caller) {
      log("auth_refused", {
        reason: key ? "unknown_or_revoked" : token ? "token_refused" : "missing_or_malformed",
        // Noms d'en-têtes et longueurs seulement : de quoi diagnostiquer un client mal réglé.
        headers: describeCredentialHeaders(request.headers),
      });
      // En-tête WWW-Authenticate : ASCII uniquement, d'où l'absence d'accents.
      const challenge = bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "Cle API ou jeton absent, invalide ou revoque"),
      );
      return oauth ? withResourceMetadata(challenge, oauth) : challenge;
    }

    try {
      return await mcp.fetch(request, { authInfo: authInfoOf(caller) });
    } catch (error) {
      log("mcp_error", { code: errorCode(error) });
      return new Response(null, { status: 500 });
    }
  };
}

// Le client OAuth découvre le serveur d'autorisation par resource_metadata (RFC 9728).
function withResourceMetadata(response: Response, oauth: OAuthDeps): Response {
  const headers = new Headers(response.headers);
  const challenge = headers.get("www-authenticate") ?? "Bearer";
  headers.set(
    "www-authenticate",
    `${challenge}, resource_metadata="${oauth.resource}/oauth-protected-resource"`,
  );
  return new Response(response.body, { status: response.status, headers });
}

// L'appelant voyage dans authInfo jusqu'à la fabrique de serveur et aux tools
// (ctx.http.authInfo). Jamais la clé ni le jeton en clair : le serveur n'en a plus besoin.
function authInfoOf(caller: McpCaller): AuthInfo {
  const clientId = caller.via === "api_key" ? `api_key:${caller.keyId}` : "oauth";
  return { token: "", clientId, scopes: [], extra: { ...caller } };
}

function callerOf(authInfo: AuthInfo | undefined): McpCaller {
  const extra = authInfo?.extra;
  if (typeof extra?.userId !== "string") throw new Error("Appelant non authentifié");
  if (extra.via === "api_key" && typeof extra.keyId === "number") {
    return { via: "api_key", userId: extra.userId, keyId: extra.keyId };
  }
  if (extra.via === "oauth") return { via: "oauth", userId: extra.userId };
  throw new Error("Appelant non authentifié");
}
