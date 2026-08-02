import * as fs from 'fs';
import * as path from 'path';

import { ValidationThreshold } from '@korzun/epubcheck-ts';

import { logger } from './logger';
import { AppConfig } from './types';

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
      };
    } catch {
      log.warn(`Could not parse ${optionsPath}, using defaults`);
    }
  }

  return {
    libraryName: (process.env.LIBRARY_NAME ?? options.library_name).trim() || 'Bookplate',
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
  };
}
