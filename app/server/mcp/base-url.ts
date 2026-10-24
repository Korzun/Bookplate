/**
 * The origin the MCP server, its OAuth endpoints and its metadata documents
 * are published under. Derived ONLY from `public_url` — never from a request's
 * `Host` header, for the reason `AppConfig.publicUrl`'s doc comment gives for
 * email links: a header-derived absolute URL is a poisoning path, and an OAuth
 * issuer is the same class of thing.
 *
 * https is required because the SDK's metadata router refuses a plain-http
 * issuer (RFC 8414), with the SDK's own exemption for `localhost`/`127.0.0.1`
 * kept so a developer can run the whole flow locally. A LAN-only http
 * `public_url` therefore yields null, and MCP stays off — `index.ts` logs why.
 */
export function resolveMcpBaseUrl(publicUrl: string | null | undefined): URL | null {
  if (!publicUrl) return null;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return null;
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) return null;
  // Origin only: no path, query or fragment can ride along into the issuer.
  return new URL(url.origin);
}

/** The MCP endpoint itself, which is also the OAuth resource identifier. */
export const mcpEndpointUrl = (baseUrl: URL): string => new URL('/mcp', baseUrl).href;

/** Where `provider.authorize` sends the browser for consent. */
export const consentUrl = (baseUrl: URL): URL => new URL('/connect', baseUrl);
