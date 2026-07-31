import type { PrismaClient } from '@prisma/client';

import type { BookStore } from '../services/book-store';
import type { DeviceStore } from '../services/device-store';
import type { EditionStore } from '../services/edition-store';
import { verifyAccessToken } from '../services/jwt';
import type { ScanJobStore } from '../services/scan-job-store';
import type { ThumbnailQueue } from '../services/thumbnail-queue';
import type { UserStore } from '../services/user-store';
import type { ValidationStore } from '../services/validation-store';
import type { AppConfig } from '../types';

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
};

export type Context = {
  viewer: Viewer | null;
  prisma: PrismaClient;
  stores: Stores;
  config: AppConfig;
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
  ({ request }: { request: Request }): Context => ({
    viewer: viewerFromHeader(deps.jwtSecret, request.headers.get('authorization') ?? undefined),
    prisma: deps.prisma,
    stores: deps.stores,
    config: deps.config,
  });
