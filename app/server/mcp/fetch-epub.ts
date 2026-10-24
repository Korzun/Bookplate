/**
 * Downloads an EPUB a reader named by URL, for the MCP `upload_book` and
 * `stage_replacement` tools — the one place this server fetches a URL an
 * authenticated account chose, so it is the one place that needs an SSRF
 * guard stronger than a hostname check.
 *
 * Resolve-then-pin: the hostname is resolved ONCE here, every address it
 * yields is checked with `isPrivateHost`, and the socket is opened to that
 * vetted address through a `lookup` that never consults DNS again — so a
 * name that answers publicly at check time cannot answer privately at
 * connect time (the rebinding gap `add-push-subscription.ts`'s comment names
 * and leaves open for push endpoints). Redirects are followed by hand so each
 * hop is vetted the same way; a `Location` into the Supervisor network fails
 * exactly as a direct URL to it does.
 *
 * The body streams straight to a file in `destDir` (never buffered: a 200 MB
 * EPUB on a Pi-class host must not cost 200 MB of heap), the byte cap is
 * enforced as chunks arrive, and `timeoutMs` is a WALL-CLOCK budget for the
 * whole download, not Node's idle timeout — a server that drips one byte a
 * second is cut off at the deadline. Every failure removes the partial file.
 *
 * Nothing in a stream listener may throw: a throw there is an
 * `uncaughtException`, not a rejected promise, and would take the process
 * down. Listener bodies are wrapped and filename derivation runs after the
 * stream has settled.
 *
 * `request` and `lookup` are injectable for tests; production uses Node's.
 */
import { randomUUID } from 'crypto';
import * as dns from 'dns';
import * as fs from 'fs';
import * as https from 'https';
import type { LookupFunction } from 'net';
import * as path from 'path';

import { isPrivateHost } from '../utils/private-host';

export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_REDIRECTS = 5;

export type FetchEpubErrorCode =
  | 'invalid_url'
  | 'private_host'
  | 'too_many_redirects'
  | 'too_large'
  | 'not_epub'
  | 'http_error'
  | 'timeout';

export class FetchEpubError extends Error {
  readonly code: FetchEpubErrorCode;
  constructor(code: FetchEpubErrorCode, message: string) {
    super(message);
    this.name = 'FetchEpubError';
    this.code = code;
  }
}

/** `dns.lookup`'s `{ all: true }` shape — the only form this module calls. */
export type AllLookup = (
  hostname: string,
  options: { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
) => void;

export type FetchEpubOptions = {
  lookup?: AllLookup;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  request?: typeof https.request;
};

export type FetchedEpub = {
  /** A fresh file inside `destDir`; the caller owns it from here on. */
  path: string;
  size: number;
  /** Suggested original name, always ending in `.epub`. */
  filename: string;
};

const resolveAll = (lookup: AllLookup, hostname: string): Promise<dns.LookupAddress[]> =>
  new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

/** A `net`-compatible lookup that answers with the address already vetted. */
const pinnedLookup =
  (address: dns.LookupAddress): LookupFunction =>
  (_hostname, options, callback) => {
    // Node asks with `all: true` under `autoSelectFamily`; honour both shapes.
    if (typeof options === 'object' && options !== null && options.all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };

const filenameFromDisposition = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended !== null) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain === null ? null : plain[1].trim();
};

/** The URL path's last segment, decoded when it decodes, raw when it does not. */
const filenameFromPath = (url: URL): string => {
  const raw = path.posix.basename(url.pathname);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const forceEpubName = (name: string): string => {
  const base = path.basename(name).trim() || 'book';
  return base.toLowerCase().endsWith('.epub') ? base : `${base}.epub`;
};

const looksLikeEpub = (contentType: string | undefined, url: URL): boolean => {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/epub+zip') return true;
  return url.pathname.toLowerCase().endsWith('.epub');
};

const unlinkQuiet = (file: string): void => {
  try {
    fs.unlinkSync(file);
  } catch {
    /* never written, or already gone */
  }
};

type HopOutcome =
  | { redirect: string }
  | { done: true; size: number; contentDisposition: string | undefined };

/** One request: resolves on a redirect or a fully written body, rejects on anything else. */
function performHop(
  url: URL,
  address: dns.LookupAddress,
  destPath: string,
  budgetMs: number,
  maxBytes: number,
  request: typeof https.request
): Promise<HopOutcome> {
  return new Promise<HopOutcome>((resolve, reject) => {
    let settled = false;
    let sink: fs.WriteStream | null = null;
    const finish = (outcome: { ok: HopOutcome } | { err: Error }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ('err' in outcome) {
        if (sink !== null) sink.destroy();
        reject(outcome.err);
      } else {
        resolve(outcome.ok);
      }
    };

    const req = request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup(address),
        servername: url.hostname,
        headers: { accept: 'application/epub+zip, */*;q=0.1', 'user-agent': 'Bookplate' },
      },
      (res) => {
        try {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && typeof res.headers.location === 'string') {
            res.resume();
            finish({ ok: { redirect: res.headers.location } });
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            finish({ err: new FetchEpubError('http_error', `The server answered ${status}`) });
            return;
          }
          if (!looksLikeEpub(res.headers['content-type'], url)) {
            res.resume();
            finish({ err: new FetchEpubError('not_epub', 'That URL is not an EPUB file') });
            return;
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > maxBytes) {
            res.resume();
            finish({
              err: new FetchEpubError('too_large', 'That file is larger than the upload limit'),
            });
            return;
          }
          const stream = fs.createWriteStream(destPath, { flags: 'wx' });
          sink = stream;
          let total = 0;
          stream.on('error', (err) => finish({ err }));
          res.on('data', (chunk: Buffer) => {
            try {
              total += chunk.length;
              if (total > maxBytes) {
                req.destroy();
                finish({
                  err: new FetchEpubError('too_large', 'That file is larger than the upload limit'),
                });
                return;
              }
              stream.write(chunk);
            } catch (err) {
              finish({ err: err as Error });
            }
          });
          res.on('end', () => {
            try {
              stream.end(() => {
                finish({
                  ok: {
                    done: true,
                    size: total,
                    contentDisposition: res.headers['content-disposition'],
                  },
                });
              });
            } catch (err) {
              finish({ err: err as Error });
            }
          });
          res.on('error', (err) => finish({ err }));
        } catch (err) {
          finish({ err: err as Error });
        }
      }
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish({ err: new FetchEpubError('timeout', 'The download took too long') });
    }, budgetMs);

    req.on('error', (err: Error) => {
      finish({
        err:
          err instanceof FetchEpubError
            ? err
            : new FetchEpubError('http_error', `Could not download: ${err.message}`),
      });
    });
    req.end();
  });
}

export async function fetchEpub(
  rawUrl: string,
  destDir: string,
  options: FetchEpubOptions = {}
): Promise<FetchedEpub> {
  const lookup = options.lookup ?? (dns.lookup as unknown as AllLookup);
  const request = options.request ?? https.request;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = Date.now() + timeoutMs;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchEpubError('invalid_url', 'Not a valid URL');
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `mcp-fetch-${randomUUID()}.epub`);

  try {
    for (let hop = 0; ; hop += 1) {
      if (url.protocol !== 'https:') {
        throw new FetchEpubError('invalid_url', 'Only https URLs can be fetched');
      }
      if (isPrivateHost(url.hostname)) {
        throw new FetchEpubError('private_host', 'That host is not reachable from here');
      }
      let addresses: dns.LookupAddress[];
      try {
        addresses = await resolveAll(lookup, url.hostname);
      } catch {
        throw new FetchEpubError('http_error', `Could not resolve ${url.hostname}`);
      }
      if (addresses.length === 0 || addresses.some((a) => isPrivateHost(a.address))) {
        throw new FetchEpubError('private_host', 'That host is not reachable from here');
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new FetchEpubError('timeout', 'The download took too long');

      const outcome = await performHop(url, addresses[0], destPath, remaining, maxBytes, request);

      if ('redirect' in outcome) {
        if (hop >= maxRedirects) {
          throw new FetchEpubError('too_many_redirects', 'Too many redirects');
        }
        try {
          url = new URL(outcome.redirect, url);
        } catch {
          throw new FetchEpubError('invalid_url', 'The server redirected to an invalid URL');
        }
        continue;
      }

      const name = filenameFromDisposition(outcome.contentDisposition) ?? filenameFromPath(url);
      return { path: destPath, size: outcome.size, filename: forceEpubName(name) };
    }
  } catch (err) {
    unlinkQuiet(destPath);
    throw err;
  }
}
