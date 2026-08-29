import type { PrismaClient } from '@prisma/client';

import { verifyAccessToken } from '../services/jwt';
import type { ReplaceStaging } from '../services/replace-staging';
import type { ScanJobRegistry } from '../services/scan-job-registry';
import type { ThumbnailQueue } from '../services/thumbnail-queue';
import type { AppConfig } from '../types';
import { createBookByDocumentLoader, type BookByDocumentLoader } from './book-by-document-loader';
import {
  createChapterSpineMapLoader,
  type ChapterSpineMapLoader,
} from './chapter-spine-map-loader';
import {
  createDeviceEditionCountLoader,
  type DeviceEditionCountLoader,
} from './device-edition-count-loader';
import { createOwnerLoader, type OwnerLoader } from './owner';
import { createPendingFixLoader, type PendingFixLoader } from './pending-fix-loader';
import { createProgressLoader, type ProgressLoader } from './progress-loader';
import { createSeriesProgressLoader, type SeriesProgressLoader } from './series-progress-loader';
import {
  createValidationCountsLoader,
  type ValidationCountsLoader,
} from './validation-counts-loader';

/**
 * The WHATWG/undici `Request` yoga hands to the context factory — deliberately
 * NOT Express's `Request`, which server.ts imports under the same identifier
 * one file away. The alias keeps the two from being read as the same type.
 */
type FetchRequest = globalThis.Request;

/**
 * The authenticated identity behind a request. `userId` is null for the
 * config-based admin, which has no row in the users table.
 */
export type Viewer = {
  userId: string | null;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

export type Context = {
  viewer: Viewer | null;
  prisma: PrismaClient;
  scanJobs: ScanJobRegistry;
  thumbnails: ThumbnailQueue;
  /**
   * The same instance `routes/ui.ts`'s `POST /api/books/replace-staging`
   * writes into — constructed once in `index.ts` and passed to both
   * `createUiRouter` and `createGraphqlHandler`'s context deps, never one
   * instance per transport. Two separate instances would each hold their own
   * empty in-memory registry, so a `stagedUploadId` minted by the REST route
   * would never resolve here — see `replace-staging.ts`'s doc comment for why
   * the registry is in-memory and per-process to begin with.
   */
  replaceStaging: ReplaceStaging;
  /** `path.join(config.dataDir, 'editions')` — see `index.ts`'s identical wiring. */
  editionsRoot: string;
  config: AppConfig;
  loadOwner: OwnerLoader;
  loadProgress: ProgressLoader;
  loadPendingFix: PendingFixLoader;
  loadChapterSpineMap: ChapterSpineMapLoader;
  loadSeriesProgress: SeriesProgressLoader;
  loadValidationCounts: ValidationCountsLoader;
  loadBookByDocument: BookByDocumentLoader;
  loadDeviceEditionCount: DeviceEditionCountLoader;
};

export type ContextDeps = {
  prisma: PrismaClient;
  scanJobs: ScanJobRegistry;
  thumbnails: ThumbnailQueue;
  replaceStaging: ReplaceStaging;
  editionsRoot: string;
  config: AppConfig;
  jwtSecret: Buffer;
};

/** Derives the viewer from an Authorization header. Pure. */
export const viewerFromHeader = (secret: Buffer, header: string | undefined): Viewer | null => {
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  const user = verifyAccessToken(secret, header.slice(7));
  if (user === null) return null;
  return {
    userId: user.userId ?? null,
    username: user.username,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword,
  };
};

/**
 * Asserts the `authenticated` scope already ran. This is an invariant check,
 * not error handling: every field in the schema carries that scope, so a null
 * viewer here means the builder was misconfigured, not that a request failed.
 */
export const requireViewer = (context: Context): Viewer => {
  if (context.viewer === null) {
    throw new Error('requireViewer called without an authenticated viewer');
  }
  return context.viewer;
};

export const createContext =
  (deps: ContextDeps) =>
  ({ request }: { request: FetchRequest }): Context => ({
    viewer: viewerFromHeader(deps.jwtSecret, request.headers.get('authorization') ?? undefined),
    prisma: deps.prisma,
    scanJobs: deps.scanJobs,
    thumbnails: deps.thumbnails,
    replaceStaging: deps.replaceStaging,
    editionsRoot: deps.editionsRoot,
    config: deps.config,
    loadOwner: createOwnerLoader(deps.prisma),
    loadProgress: createProgressLoader(deps.prisma),
    loadPendingFix: createPendingFixLoader(deps.prisma),
    loadChapterSpineMap: createChapterSpineMapLoader(deps.prisma),
    loadSeriesProgress: createSeriesProgressLoader(deps.prisma),
    loadValidationCounts: createValidationCountsLoader(deps.prisma),
    loadBookByDocument: createBookByDocumentLoader(deps.prisma),
    loadDeviceEditionCount: createDeviceEditionCountLoader(deps.prisma),
  });
