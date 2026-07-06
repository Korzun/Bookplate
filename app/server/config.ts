import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { logger } from './logger';
import { ValidationThreshold } from '@korzun/epubcheck-ts';

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
      process.env.VALIDATION_THRESHOLD ?? options.validation_threshold,
    ),
  };
}
