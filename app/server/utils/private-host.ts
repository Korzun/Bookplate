/**
 * Whether a URL host names something on the install's own network — the
 * rule every outbound URL a reader can supply (push endpoints, MCP upload
 * URLs) is checked against. Lived inline in
 * `graphql/schema/viewer/mutation/add-push-subscription.ts` until the MCP
 * server needed the same check for fetched EPUBs.
 */
/**
 * Host suffixes that name a machine on this network rather than a push
 * service. `.lan`/`.home.arpa` are the usual router-assigned domains and
 * `.internal` is the convention for private zones; `.local` is mDNS.
 */
const PRIVATE_HOST_SUFFIXES = ['.local', '.internal', '.home.arpa', '.lan'];

/**
 * Whether a URL host names something on the install's own network.
 *
 * Covers what can be decided from the STRING: literal addresses in the
 * private, loopback and link-local ranges, and the hostname forms that only
 * resolve on a LAN. It deliberately does NOT resolve DNS — that would put
 * network I/O in a validator, and a name that resolves publicly at check time
 * can resolve privately at send time (DNS rebinding), so resolving here would
 * buy a false sense of completeness rather than a real bound.
 */
export function isPrivateHost(hostname: string): boolean {
  // `URL.hostname` keeps the brackets on an IPv6 literal.
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4 !== null) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;
    // 100.64.0.0/10: carrier-grade NAT, and what Tailscale hands out — an
    // HA box on a tailnet can reach every peer through it.
    if (first === 100 && second >= 64 && second <= 127) return true;
    return false;
  }

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    // An IPv4-mapped address, which the URL parser normalises to hex:
    // `::ffff:192.168.1.1` arrives as `::ffff:c0a8:101`. Decode the two
    // groups back to dotted quad rather than matching the readable spelling
    // the parser never produces.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped !== null) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return isPrivateHost(
        `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
      );
    }
    if (host.startsWith('::ffff:')) return isPrivateHost(host.slice('::ffff:'.length));
    if (/^f[cd]/.test(host)) return true; // fc00::/7, unique local
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10, link local
    return false;
  }

  // A bare name with no dot resolves only against the local search domain.
  return !host.includes('.');
}

export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}
