import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { logger } from './logger';

const log = logger('Config');

interface Options {
  username: string;
  password: string;
  max_concurrent_uploads: number;
  thumbnail_widths: number[];
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? '/data';
  const optionsPath = path.join(dataDir, 'options.json');

  let options: Options = {
    username: 'admin',
    password: 'changeme',
    max_concurrent_uploads: 3,
    thumbnail_widths: [88, 160],
  };

  if (fs.existsSync(optionsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(optionsPath, 'utf-8')) as Partial<Options>;
      options = {
        username: parsed.username ?? options.username,
        password: parsed.password ?? options.password,
        max_concurrent_uploads: parsed.max_concurrent_uploads ?? options.max_concurrent_uploads,
        thumbnail_widths: Array.isArray(parsed.thumbnail_widths)
          ? parsed.thumbnail_widths
          : options.thumbnail_widths,
      };
    } catch {
      log.warn(`Could not parse ${optionsPath}, using defaults`);
    }
  }

  return {
    username: process.env.ADMIN_USER ?? options.username,
    password: process.env.ADMIN_PASS ?? options.password,
    booksDir: process.env.BOOKS_DIR ?? '/media/books',
    dataDir,
    port: parseInt(process.env.PORT ?? '3000', 10),
    maxConcurrentUploads: options.max_concurrent_uploads,
    thumbnailWidths: options.thumbnail_widths,
  };
}
