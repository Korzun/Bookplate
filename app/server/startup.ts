import * as fs from 'fs';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';
import type express from 'express';

import { logger } from './logger';
import { ensureAdminUser, NOT_CONFIG_ADMIN } from './services/admin-account';
import { pruneThumbnails } from './services/book-assets';
import { scan } from './services/book-lifecycle';
import { revalidateLibrary } from './services/revalidate-library';
import { ThumbnailQueue } from './services/thumbnail-queue';
import { AppConfig } from './types';

const log = logger('Server');

export type StartupDeps = {
  prisma: PrismaClient;
  config: AppConfig;
  version: string;
  thumbnailQueue: Pick<ThumbnailQueue, 'start' | 'stop' | 'reconcile'>;
  server: Pick<express.Express, 'listen'>;
};

// The startup sequence, extracted from `index.ts`'s top-level IIFE so its
// step order — most importantly, `ensureAdminUser` running before the
// startup scan below (the scan excludes the admin's row via
// `NOT_CONFIG_ADMIN`, which only exists once that call has run) — is under
// unit test rather than only exercised by booting the real process. This is
// a straight extraction: every step, comment, and log line below is moved
// verbatim from `index.ts`, not revised.
export async function startBookplate({
  prisma,
  config,
  version,
  thumbnailQueue,
  server,
}: StartupDeps): Promise<void> {
  // Before the startup scan: the scan excludes the admin's row via
  // `NOT_CONFIG_ADMIN` below, and every email flow needs this row to exist.
  await ensureAdminUser(prisma, config.username);

  // Startup scan: per user — create missing folders, import untracked EPUBs,
  // clean up stale DB entries, then re-validate the imported library.
  //
  // This is now the ONLY scan the app performs. It runs the same three-step
  // pipeline the user-triggered `libraryScan` mutation used to run in its
  // detached background block (scan → revalidateLibrary → thumbnail
  // reconcile), so removing that mutation cost the app no behaviour, only the
  // ability to start it on demand. `revalidateLibrary` and
  // `ThumbnailQueue.reconcile` had no other production caller.
  //
  // `reconcile()` is library-wide, not per-owner, so it runs ONCE after the
  // loop rather than once per user — the mutation only ever scanned a single
  // owner, so its per-call placement inside the pipeline and this one outside
  // the loop are the same thing.
  try {
    // Single-statement `findMany`, one production caller — inlined under
    // the placement rule. No unit test covers this directly (it runs only
    // as part of server startup); `graphql/schema/viewer/users.test.ts`'s
    // "lists every user ... ordered by username" test covers the identical
    // shape (`findMany` + `orderBy: { username: 'asc' }`) for the separate
    // `Viewer.users` resolver, which is the closest existing coverage.
    // `where: NOT_CONFIG_ADMIN` — the config-based admin owns no library, and
    // it must be excluded by the flag, not by name: `ensureAdminUser` refuses
    // to adopt a non-admin row that happens to bear `config.username` (see its
    // doc comment, case 3), so that username can legitimately belong to a real
    // reader while the admin's own (differently-named) row exists separately.
    // A name comparison here would silently skip that reader's library scan.
    const ownerRows = await prisma.user.findMany({
      where: NOT_CONFIG_ADMIN,
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });
    const owners = ownerRows.map((r) => ({ userId: r.id, username: r.username }));
    let scanned = 0;
    let imported = 0;
    let removed = 0;
    let validated = 0;
    let failedValidation = 0;
    for (const owner of owners) {
      fs.mkdirSync(path.join(config.booksDir, owner.username), { recursive: true });
      const scanResult = await scan(prisma, config.booksDir, owner);
      const val = await revalidateLibrary(
        {
          prisma,
          booksRoot: config.booksDir,
          validationThreshold: config.validationThreshold,
        },
        owner
      );
      scanned++;
      imported += scanResult.imported.length;
      removed += scanResult.removed.length;
      validated += val.validated;
      failedValidation += val.failed;
    }
    await thumbnailQueue.reconcile();
    log.info(
      `Startup scan (${scanned} user(s)): ${imported} imported, ${removed} removed, ` +
        `${validated} validated (${failedValidation} failed)`
    );
  } catch (err: unknown) {
    log.error(`Startup scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const regenRow = await prisma.setting.findUnique({ where: { key: 'regenerate_covers' } });
  if (!regenRow) {
    await prisma.setting.create({ data: { key: 'regenerate_covers', value: 'false' } });
  } else if (regenRow.value === 'true') {
    await prisma.setting.update({ where: { key: 'regenerate_covers' }, data: { value: 'false' } });
    const deleted = await pruneThumbnails(prisma, []);
    log.info(`regenerate_covers: deleted ${deleted} thumbnail(s), queuing regeneration`);
  }

  await thumbnailQueue.start();

  const shutdown = async (): Promise<void> => {
    log.info('Server shutting down');
    thumbnailQueue.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  server.listen(config.port, () => {
    log.info(
      `Bookplate v${version} starting — port: ${config.port}, booksDir: ${config.booksDir}, dataDir: ${config.dataDir}`
    );
    log.info(`Web UI:  http://localhost:${config.port}/`);
    log.info(`OPDS:    http://localhost:${config.port}/opds/`);
    log.info(`KOSync:  http://localhost:${config.port}/sync/`);
  });
}
