import * as fs from 'fs';
import * as path from 'path';

import { ValidationThreshold } from '@korzun/epubcheck-ts';

import { logger } from './logger';
import { AppConfig, MailConfig } from './types';

const log = logger('Config');

const MEDIA_ROOT = '/media';

export function resolveBooksDir(libraryDir: string): string {
  const fallback = path.join(MEDIA_ROOT, 'books');
  const cleaned = libraryDir.trim().replace(/^\/+/, '');
  if (cleaned === '') {
    log.warn(`Empty library_dir, using ${fallback}`);
    return fallback;
  }
  const resolved = path.resolve(MEDIA_ROOT, cleaned);
  const rel = path.relative(MEDIA_ROOT, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    log.warn(`library_dir "${libraryDir}" escapes ${MEDIA_ROOT}, using ${fallback}`);
    return fallback;
  }
  return resolved;
}

interface Options {
  library_name: string;
  library_dir: string;
  username: string;
  password: string;
  max_concurrent_uploads: number;
  thumbnail_widths: number[];
  validation_threshold: string;
  trust_proxy_hops: number;
  email_cloudflare_account_id: string;
  email_cloudflare_api_token: string;
  email_from_address: string;
  email_from_name: string;
  public_url: string;
}

/**
 * `TRUST_PROXY_HOPS` (bare-metal/dev env var) or `trust_proxy_hops`
 * (Home Assistant add-on option, `config.yaml`'s `options`/`schema`,
 * review D-1 — the add-on has no env-var surface at all, `run.sh` execs
 * `node` with no arguments, so `options.json` was the only reachable path
 * and this field was the one `AppConfig` knob missing from it) — see
 * `AppConfig.trustProxyHops`'s doc comment (`types.ts`) for what this does
 * and doesn't affect. Accepts either source's raw shape (env vars are
 * always strings; `options.json`, parsed from the add-on schema's `int`
 * type, is already a number) and defaults to `0` (trust nothing) on any
 * missing/malformed/non-positive value from EITHER source — the same
 * conservative-default requirement that field's doc comment states,
 * enforced here so a typo'd env var or a hand-edited `options.json` can
 * only ever fail SAFE (toward "don't trust the header"), never open the
 * limiter up to spoofing.
 */
function parseTrustProxyHops(raw: string | number | undefined): number {
  if (raw === undefined) return 0;
  const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseThreshold(raw: string): ValidationThreshold {
  switch (raw.trim().toLowerCase()) {
    case 'fatal':
      return ValidationThreshold.FATAL;
    case 'error':
      return ValidationThreshold.ERROR;
    case 'warning':
      return ValidationThreshold.WARNING;
    case 'info':
      return ValidationThreshold.INFO;
    default:
      log.warn(`Unknown validation_threshold "${raw}", using Error`);
      return ValidationThreshold.ERROR;
  }
}

/** Trimmed value, or `''` for anything blank/missing — the "unset" spelling everywhere below. */
function trimmed(raw: string | undefined): string {
  return (raw ?? '').trim();
}

/**
 * Collapses a partial mail configuration to `null`. Account id, token and
 * from-address are all required; `fromName` falls back to the library name so
 * an operator setting the minimum still gets a sensible From display name.
 */
function parseMailConfig(
  accountId: string,
  apiToken: string,
  from: string,
  fromName: string,
  libraryName: string
): MailConfig | null {
  if (!accountId || !apiToken || !from) return null;
  return { accountId, apiToken, from, fromName: fromName || libraryName };
}

/**
 * Accepts only an absolute http(s) origin, and returns it without a trailing
 * slash so callers can concatenate a path unconditionally. Anything else is
 * `null` WITH A WARNING rather than a throw: a malformed value degrades to
 * code-only email, which works, instead of failing the whole boot or — far
 * worse — emitting a link nobody can follow.
 */
function parsePublicUrl(raw: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log.warn(`public_url "${raw}" is not an absolute URL, using code-only email`);
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    log.warn(`public_url "${raw}" is not http(s), using code-only email`);
    return null;
  }
  return url.origin;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const optionsPath = path.join(dataDir, 'options.json');

  let options: Options = {
    library_name: 'Bookplate',
    library_dir: 'books',
    username: 'admin',
    password: 'changeme',
    max_concurrent_uploads: 3,
    thumbnail_widths: [88, 160],
    validation_threshold: 'Error',
    trust_proxy_hops: 0,
    email_cloudflare_account_id: '',
    email_cloudflare_api_token: '',
    email_from_address: '',
    email_from_name: '',
    public_url: '',
  };

  if (fs.existsSync(optionsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(optionsPath, 'utf-8')) as Partial<Options>;
      options = {
        library_name: parsed.library_name ?? options.library_name,
        library_dir: parsed.library_dir ?? options.library_dir,
        username: parsed.username ?? options.username,
        password: parsed.password ?? options.password,
        max_concurrent_uploads: parsed.max_concurrent_uploads ?? options.max_concurrent_uploads,
        thumbnail_widths: Array.isArray(parsed.thumbnail_widths)
          ? parsed.thumbnail_widths
          : options.thumbnail_widths,
        validation_threshold: parsed.validation_threshold ?? options.validation_threshold,
        trust_proxy_hops: parsed.trust_proxy_hops ?? options.trust_proxy_hops,
        email_cloudflare_account_id:
          parsed.email_cloudflare_account_id ?? options.email_cloudflare_account_id,
        email_cloudflare_api_token:
          parsed.email_cloudflare_api_token ?? options.email_cloudflare_api_token,
        email_from_address: parsed.email_from_address ?? options.email_from_address,
        email_from_name: parsed.email_from_name ?? options.email_from_name,
        public_url: parsed.public_url ?? options.public_url,
      };
    } catch {
      log.warn(`Could not parse ${optionsPath}, using defaults`);
    }
  }

  const libraryName = (process.env.LIBRARY_NAME ?? options.library_name).trim() || 'Bookplate';

  return {
    libraryName,
    username: process.env.ADMIN_USER ?? options.username,
    password: process.env.ADMIN_PASS ?? options.password,
    booksDir: process.env.BOOKS_DIR ?? resolveBooksDir(options.library_dir),
    dataDir,
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxConcurrentUploads: options.max_concurrent_uploads,
    thumbnailWidths: options.thumbnail_widths,
    validationThreshold: parseThreshold(
      process.env.VALIDATION_THRESHOLD ?? options.validation_threshold
    ),
    // Env var (bare-metal/dev) takes precedence over the add-on option, same
    // "env overrides options.json" convention validationThreshold uses
    // immediately above.
    trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY_HOPS ?? options.trust_proxy_hops),
    mail: parseMailConfig(
      trimmed(process.env.CF_ACCOUNT_ID ?? options.email_cloudflare_account_id),
      trimmed(process.env.CF_API_TOKEN ?? options.email_cloudflare_api_token),
      trimmed(process.env.EMAIL_FROM ?? options.email_from_address),
      trimmed(process.env.EMAIL_FROM_NAME ?? options.email_from_name),
      libraryName
    ),
    publicUrl: parsePublicUrl(trimmed(process.env.PUBLIC_URL ?? options.public_url)),
  };
}
