import type { IncomingMessage } from 'http';

/**
 * The origin this instance tells an MCP agent to use: `config.publicUrl` when
 * the operator set one, otherwise the origin this very request arrived at.
 *
 * One rule for everything the MCP endpoint hands out — OAuth discovery
 * metadata (`routes/mcp-oauth.ts`) and file-transfer URLs (`mcp/tools.ts`) —
 * because a client checks they agree: the protected-resource metadata must
 * name the very URL the client connected to, and the issuer must match where
 * that metadata pointed. Deriving from the request is what lets an install
 * with no `public_url` work at whatever address it is reached by; an operator
 * who sets `public_url` is saying that is the address agents use.
 *
 * Deriving from `Host`/`X-Forwarded-Proto` is exactly what
 * `AppConfig.publicUrl`'s doc comment warns against for EMAIL links, and the
 * reason does not apply here: a poisoned email link reaches a victim, whereas
 * everything built from this goes back only in the response to the request
 * that carried the header. A client that lies about its own Host only
 * misdirects itself. `X-Forwarded-Proto` is honoured so an instance behind an
 * HTTPS proxy or Cloudflare Tunnel advertises `https` without `public_url`.
 */
export function publicOrigin(req: IncomingMessage, publicUrl: string | null | undefined): string {
  if (publicUrl) return publicUrl;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
  const proto = first === 'https' || first === 'http' ? first : encrypted ? 'https' : 'http';
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

/** The MCP endpoint's own URL — the OAuth "resource" its tokens are for. */
export const mcpResourceUrl = (origin: string): string => `${origin}/mcp`;
