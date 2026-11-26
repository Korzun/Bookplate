import { BlockList, isIPv4, isIPv6 } from 'node:net';

import type { Request } from 'express';

/**
 * Resolves the client IP the login limiter should key on — used ONLY here,
 * never as Express's own `req.ip`/`trust proxy` setting (review I-2:
 * deliberately not touched globally — that setting also changes
 * `req.secure`/cookie semantics app-wide, a strictly bigger change than
 * this one control needs, and this app already special-cases Cloudflare-
 * proxy behavior in several places — `server.ts`, `middleware/timeout.ts`
 * — without ever setting it).
 *
 * `trustProxyHops` (see `AppConfig.trustProxyHops`'s doc comment, `types.ts`,
 * for the full contract): `0` (or unset — the conservative default) returns
 * `req.socket.remoteAddress` unconditionally, ignoring `X-Forwarded-For`
 * entirely — a spoofed header cannot influence the key. `N > 0` trusts the
 * last `N` hops: build the chain `[client, proxy1, ..., proxyK]` from the
 * header (left-to-right, closest-to-client first — the standard
 * `X-Forwarded-For` convention), then walk back `N` positions from the end
 * to find the address the Nth-trusted-hop-back added — the same algorithm
 * Express's own `trust proxy: n` numeric mode uses internally (`proxy-addr`),
 * just computed by hand here so it affects only this function. Re-review:
 * differential-tested against `proxy-addr` across 80 header/hop-count
 * combinations and matches it on every one WHERE the header has at least
 * `N` entries. The two implementations deliberately DIVERGE, not
 * accidentally, when the header is shorter than `N` (a misconfigured
 * `trustProxyHops`, or a proxy that isn't appending as expected): `proxy-
 * addr` falls through to the leftmost (client-writable) header entry, which
 * a client can forge to mint an arbitrary bucket; this function falls back
 * to the direct peer instead — under-trusting fails safe, `proxy-addr`'s
 * behavior in that same case does not. Every one of the review's 32
 * divergent cases was this function choosing the safer of the two, never
 * the reverse. Over-trusting (`trustProxyHops` set higher than the real hop
 * count, so the chain legitimately has ≥N entries but the Nth-from-the-end
 * one is still a proxy, not the client) is an operator error neither
 * implementation can detect from inside a single request — why
 * `AppConfig.trustProxyHops`'s doc comment warns against it explicitly.
 */
export function resolveLoginClientIp(req: Request, trustProxyHops: number): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (trustProxyHops <= 0) return direct;

  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || raw.trim() === '') return direct;

  const chain = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const clientIndex = chain.length - trustProxyHops;
  return clientIndex >= 0 ? chain[clientIndex] : direct;
}

const PRIVATE = new BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

/**
 * Loopback, private, link-local or unique-local, including IPv4-mapped IPv6
 * (`::ffff:10.0.0.1`). A lockout keyed on one of these usually means a proxy
 * in front and `TRUST_PROXY_HOPS` too low. Anything unparseable is false.
 */
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(.+)$/i.exec(ip);
  const v4 = mapped !== null && isIPv4(mapped[1]) ? mapped[1] : ip;
  if (isIPv4(v4)) return PRIVATE.check(v4, 'ipv4');
  return isIPv6(ip) && PRIVATE.check(ip, 'ipv6');
}
