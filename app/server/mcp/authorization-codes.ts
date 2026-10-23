/**
 * OAuth authorization codes for `/mcp`: issued when a reader approves an agent
 * on the consent page, redeemed once at `/oauth/token`.
 *
 * In memory rather than a table, like `services/replace-staging.ts`'s staged
 * uploads and for the same reason: they live for minutes, and losing them in a
 * restart costs nothing worse than the agent asking the reader to approve again.
 * Keyed by the code's SHA-256, so the map never holds a usable code.
 */
import { createHash, randomBytes } from 'crypto';

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

/** What the reader approved, bound to the PKCE challenge the client sent. */
export type AuthorizationGrantRequest = {
  readonly clientId: string;
  readonly userId: string;
  readonly redirectUri: string;
  /** Whether the client named `redirectUri` itself (RFC 6749 §4.1.3: it must then repeat it). */
  readonly redirectUriExplicit: boolean;
  readonly codeChallenge: string;
  readonly resource: string;
};

export type AuthorizationCodes = {
  issue: (request: AuthorizationGrantRequest) => string;
  /** Reads without redeeming — the token handler checks PKCE before exchanging. */
  peek: (code: string) => AuthorizationGrantRequest | null;
  /** Redeems: a code works once, even if this call's caller then fails. */
  consume: (code: string) => AuthorizationGrantRequest | null;
};

export function createAuthorizationCodes(
  options: { ttlMs?: number; now?: () => number } = {}
): AuthorizationCodes {
  const ttlMs = options.ttlMs ?? AUTHORIZATION_CODE_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { request: AuthorizationGrantRequest; expiresAt: number }>();
  const key = (code: string) => createHash('sha256').update(code).digest('hex');

  function sweep(current: number): void {
    for (const [k, entry] of entries) if (entry.expiresAt <= current) entries.delete(k);
  }

  function find(code: string): { k: string; request: AuthorizationGrantRequest } | null {
    const k = key(code);
    const entry = entries.get(k);
    if (entry === undefined) return null;
    if (entry.expiresAt <= now()) {
      entries.delete(k);
      return null;
    }
    return { k, request: entry.request };
  }

  return {
    issue(request) {
      const current = now();
      sweep(current);
      const code = randomBytes(32).toString('base64url');
      entries.set(key(code), { request, expiresAt: current + ttlMs });
      return code;
    },
    peek: (code) => find(code)?.request ?? null,
    consume(code) {
      const found = find(code);
      if (found === null) return null;
      entries.delete(found.k);
      return found.request;
    },
  };
}
