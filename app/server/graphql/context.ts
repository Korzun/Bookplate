import type { PrismaClient } from '@prisma/client';

import type { BookStore } from '../services/book-store';
import type { DeviceStore } from '../services/device-store';
import type { EditionStore } from '../services/edition-store';
import { verifyAccessToken } from '../services/jwt';
import type { ReplaceStaging } from '../services/replace-staging';
import type { ScanJobStore } from '../services/scan-job-store';
import type { ThumbnailQueue } from '../services/thumbnail-queue';
import type { TokenStore } from '../services/token-store';
import type { UserStore } from '../services/user-store';
import type { ValidationStore } from '../services/validation-store';
import type { AppConfig } from '../types';
import { createBookByDocumentLoader, type BookByDocumentLoader } from './book-by-document-loader';
import {
  createChapterSpineMapLoader,
  type ChapterSpineMapLoader,
} from './chapter-spine-map-loader';
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

export type Stores = {
  book: BookStore;
  user: UserStore;
  device: DeviceStore;
  edition: EditionStore;
  validation: ValidationStore;
  scanJob: ScanJobStore;
  thumbnail: ThumbnailQueue;
  /**
   * The same instance `routes/ui.ts`'s `POST /api/books/replace-staging`
   * writes into — constructed once in `index.ts` and passed to both
   * `createUiRouter` and `createGraphqlHandler`'s `stores`, never one
   * instance per transport. Two separate instances would each hold their own
   * empty in-memory registry, so a `stagedUploadId` minted by the REST route
   * would never resolve here — see `replace-staging.ts`'s doc comment for why
   * the registry is in-memory and per-process to begin with.
   */
  replaceStaging: ReplaceStaging;
  /**
   * Wired in for task 6 (`userResetPassword`/`userChangePassword`): every
   * outstanding refresh token for the affected username is revoked right
   * after either write, so a stolen/old refresh token cannot outlive a
   * password change. The same rule REST applied on `routes/users.ts`'s
   * `POST /:username/reset-password`, the one surviving REST password
   * write, before Phase 0 removed that router. GraphQL cannot reach
   * the `tokenStore` instance `server.ts` builds for it any other way, so
   * the same shared instance is threaded through here too — same "one
   * instance, never a second one" rule as `replaceStaging` above. GraphQL cannot reproduce REST's *cookie* reissue
   * half of that flow (no response object reaches this context — see
   * `createContext` below): a `userResetPassword`/`userChangePassword` caller
   * does NOT recover a fresh token via REST's `/api/auth/refresh` afterward —
   * `revokeAllForUsername` deletes the very refresh-token row that endpoint
   * would need, so it 401s instead. The caller's already-issued *access*
   * token (a stateless JWT) simply keeps its stale claim for the rest of its
   * short life, gated out of everything, until they log in again — see
   * `user/mutation/change-password.ts`'s doc comment for the full trace.
   * Revocation, the security-relevant half, is fully mirrored; only the
   * convenience of an immediately-fresh token is not.
   */
  token: TokenStore;
};

export type Context = {
  viewer: Viewer | null;
  prisma: PrismaClient;
  stores: Stores;
  config: AppConfig;
  loadOwner: OwnerLoader;
  loadProgress: ProgressLoader;
  loadPendingFix: PendingFixLoader;
  loadChapterSpineMap: ChapterSpineMapLoader;
  loadSeriesProgress: SeriesProgressLoader;
  loadValidationCounts: ValidationCountsLoader;
  loadBookByDocument: BookByDocumentLoader;
};

export type ContextDeps = {
  prisma: PrismaClient;
  stores: Stores;
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
    stores: deps.stores,
    config: deps.config,
    loadOwner: createOwnerLoader(deps.prisma),
    loadProgress: createProgressLoader(deps.prisma),
    loadPendingFix: createPendingFixLoader(deps.prisma),
    loadChapterSpineMap: createChapterSpineMapLoader(deps.prisma),
    loadSeriesProgress: createSeriesProgressLoader(deps.prisma),
    loadValidationCounts: createValidationCountsLoader(deps.prisma),
    loadBookByDocument: createBookByDocumentLoader(deps.prisma),
  });
