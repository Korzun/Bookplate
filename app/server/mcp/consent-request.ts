/**
 * Carries a validated `/oauth/authorize` request to the consent page and back.
 *
 * The SDK's authorization handler has already checked the client, its
 * redirect URI and the PKCE parameters by the time `authorize` runs
 * (`mcp/oauth-provider.ts`); this signs exactly those checked values into a
 * short-lived JWT the browser carries to `/oauth/consent`. The consent API
 * (`routes/mcp-oauth.ts`) trusts nothing else from the browser: approving
 * re-reads every parameter from here, so the page cannot swap in a different
 * client or redirect URI.
 *
 * Same secret as the web session and transfer tickets, kept apart by its own
 * `aud` — see `mcp/transfer-ticket.ts` for why that is enough.
 */
import jwt from 'jsonwebtoken';

const AUDIENCE = 'bookplate-mcp-consent';

/** Long enough to sign in first on the way to the consent page. */
export const CONSENT_REQUEST_TTL_SECONDS = 15 * 60;

export type ConsentRequest = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly redirectUriExplicit: boolean;
  readonly codeChallenge: string;
  readonly state: string | null;
  readonly resource: string;
};

export function signConsentRequest(secret: Buffer, request: ConsentRequest): string {
  return jwt.sign(
    {
      cid: request.clientId,
      ru: request.redirectUri,
      rux: request.redirectUriExplicit,
      cc: request.codeChallenge,
      st: request.state,
      res: request.resource,
    },
    secret,
    { algorithm: 'HS256', audience: AUDIENCE, expiresIn: CONSENT_REQUEST_TTL_SECONDS }
  );
}

/** `null` for anything not a valid, unexpired consent request. */
export function verifyConsentRequest(secret: Buffer, raw: string): ConsentRequest | null {
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(raw, secret, { algorithms: ['HS256'], audience: AUDIENCE }) as jwt.JwtPayload;
  } catch {
    return null;
  }
  if (
    typeof p.cid !== 'string' ||
    typeof p.ru !== 'string' ||
    typeof p.rux !== 'boolean' ||
    typeof p.cc !== 'string' ||
    (p.st !== null && typeof p.st !== 'string') ||
    typeof p.res !== 'string'
  ) {
    return null;
  }
  return {
    clientId: p.cid,
    redirectUri: p.ru,
    redirectUriExplicit: p.rux,
    codeChallenge: p.cc,
    state: p.st,
    resource: p.res,
  };
}
