import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./logger');
// Keep NOT_CONFIG_ADMIN real (the startup scan's `where` clause needs it);
// only stub ensureAdminUser so the ordering assertion below doesn't need a
// real database row.
vi.mock('./services/admin-account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/admin-account')>()),
  ensureAdminUser: vi.fn().mockResolvedValue('admin-id'),
}));
vi.mock('./services/book-lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/book-lifecycle')>()),
  scan: vi.fn().mockResolvedValue({ imported: [], removed: [] }),
}));
vi.mock('./services/revalidate-library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/revalidate-library')>()),
  revalidateLibrary: vi.fn().mockResolvedValue({ validated: 0, failed: 0 }),
}));

import { ensureAdminUser } from './services/admin-account';
import { scan } from './services/book-lifecycle';
import { revalidateLibrary } from './services/revalidate-library';
import { startBookplate, type StartupDeps } from './startup';
import { AppConfig } from './types';

const config: AppConfig = {
  libraryName: 'Bookplate',
  username: 'admin',
  password: 'pass',
  booksDir: '',
  dataDir: '/tmp',
  port: 3000,
  maxConcurrentUploads: 3,
  thumbnailWidths: [86, 160],
  validationThreshold: 'ERROR',
};

let booksDir: string;
let deps: StartupDeps;
let listenCallback: (() => void) | undefined;

beforeEach(() => {
  // The vi.mock() factories above only set these defaults once, at module
  // load; vite.config.ts's `mockReset: true` wipes every mock (including
  // these) before each test, so they must be re-armed here on every run.
  vi.mocked(ensureAdminUser).mockResolvedValue('admin-id');
  vi.mocked(scan).mockResolvedValue({ imported: [], removed: [] });
  vi.mocked(revalidateLibrary).mockResolvedValue({ validated: 0, failed: 0 });

  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-'));
  listenCallback = undefined;

  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: 'user_1', username: 'alice' }]),
    },
    setting: {
      findUnique: vi.fn().mockResolvedValue({ key: 'regenerate_covers', value: 'false' }),
      create: vi.fn(),
      update: vi.fn(),
    },
    $disconnect: vi.fn(),
  } as unknown as PrismaClient;

  const thumbnailQueue = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    reconcile: vi.fn().mockResolvedValue({ bookCount: 0 }),
  };

  const server = {
    listen: vi.fn((_port: number, cb?: () => void) => {
      listenCallback = cb;
      return undefined as never;
    }),
  };

  deps = {
    prisma,
    config: { ...config, booksDir },
    version: '1.0.0',
    thumbnailQueue,
    server,
  } as unknown as StartupDeps;
});

afterEach(() => {
  fs.rmSync(booksDir, { recursive: true, force: true });
});

describe('startBookplate', () => {
  it('calls ensureAdminUser before the startup scan', async () => {
    await startBookplate(deps);

    expect(ensureAdminUser).toHaveBeenCalledWith(deps.prisma, config.username);
    expect(scan).toHaveBeenCalled();

    const adminCallOrder = vi.mocked(ensureAdminUser).mock.invocationCallOrder[0];
    const scanCallOrder = vi.mocked(scan).mock.invocationCallOrder[0];
    expect(adminCallOrder).toBeLessThan(scanCallOrder);
  });

  it('starts the thumbnail queue before calling server.listen', async () => {
    await startBookplate(deps);

    const startOrder = vi.mocked(deps.thumbnailQueue.start).mock.invocationCallOrder[0];
    const listenOrder = vi.mocked(deps.server.listen).mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(listenOrder);
  });

  it('calls server.listen with the configured port', async () => {
    await startBookplate(deps);

    expect(deps.server.listen).toHaveBeenCalledWith(config.port, expect.any(Function));
    expect(listenCallback).toBeDefined();
  });
});
