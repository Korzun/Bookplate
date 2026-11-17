import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ValidationThreshold } from '@korzun/epubcheck-ts';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import type { ImportEpubDeps } from '../services/import-epub';
import { validateUser } from '../services/password';
import { ThumbnailQueue } from '../services/thumbnail-queue';
import type { AppConfig } from '../types';
import { seedDemo } from './seed';

vi.mock('../logger');

const SEED_PASSWORD = 'demo-seed-test-password';
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const DAY_S = 24 * 60 * 60;

type Root = { deps: ImportEpubDeps; cleanup: () => Promise<void> };

/** A fresh temp library + SQLite, like `services/import-epub.test.ts`'s harness, but with no users. */
async function freshRoot(): Promise<Root> {
  const booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-seed-books-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookplate-seed-data-'));
  const dbPath = path.join(dataDir, 'seed.sqlite');
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksDir);
  const config: AppConfig = {
    libraryName: 'Seed Test Library',
    username: 'admin',
    password: 'adminpass',
    booksDir,
    dataDir,
    port: 0,
    maxConcurrentUploads: 1,
    thumbnailWidths: [200],
    validationThreshold: ValidationThreshold.ERROR,
    seedDemo: true,
    seedPassword: SEED_PASSWORD,
    mail: null,
  };
  // Constructed but never started: `enqueue` only pushes onto an in-memory array.
  const thumbnailQueue = new ThumbnailQueue(prisma, config.thumbnailWidths);
  return {
    deps: { prisma, config, editionsRoot: path.join(dataDir, 'editions'), thumbnailQueue },
    cleanup: async () => {
      await prisma.$disconnect();
      fs.rmSync(booksDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Seeds with the system clock frozen at NOW (ruling R1): the EPUB writer and
 * reimport may stamp `dcterms:modified` from `Date.now()`, and book ids are
 * content hashes. Only `Date` is faked so async I/O keeps working.
 */
async function seedFrozen(root: Root): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    await seedDemo(root.deps, { now: NOW });
  } finally {
    vi.useRealTimers();
  }
}

async function userId(prisma: PrismaClient, username: string): Promise<string> {
  return (await prisma.user.findUniqueOrThrow({ where: { username } })).id;
}

async function bookId(prisma: PrismaClient, uid: string, title: string): Promise<string> {
  return (await prisma.book.findFirstOrThrow({ where: { userId: uid, title } })).id;
}

/** The facts the repeatability test compares, read back from the database. */
async function snapshot(prisma: PrismaClient) {
  const users = await prisma.user.findMany({ orderBy: { username: 'asc' } });
  const out: Record<string, unknown> = {};
  for (const u of users) {
    const books = await prisma.book.findMany({ where: { userId: u.id }, select: { id: true } });
    const requests = await prisma.bookRequest.findMany({
      where: { userId: u.id },
      select: { title: true, status: true },
    });
    const progress = await prisma.progress.findMany({
      where: { userId: u.id },
      select: { document: true, percentage: true },
    });
    out[u.username] = {
      books: books.map((b) => b.id).sort(),
      requests: requests.map((r) => `${r.title}|${r.status}`).sort(),
      progress: progress.map((p) => `${p.document}|${p.percentage}`).sort(),
    };
  }
  return out;
}

describe('seedDemo', { timeout: 180_000 }, () => {
  let root: Root;
  let prisma: PrismaClient;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeAll(async () => {
    root = await freshRoot();
    prisma = root.deps.prisma;
    await seedFrozen(root);
    alice = await userId(prisma, 'alice');
    bob = await userId(prisma, 'bob');
    carol = await userId(prisma, 'carol');
  }, 180_000);

  afterAll(async () => {
    await root?.cleanup();
  });

  it('creates alice, bob and carol, each accepting SEED_PASSWORD', async () => {
    for (const username of ['alice', 'bob', 'carol']) {
      expect(await validateUser(prisma, username, SEED_PASSWORD), username).toBeTruthy();
    }
    const carolRow = await prisma.user.findUniqueOrThrow({ where: { id: carol } });
    expect(carolRow.mustChangePassword).toBe(false);
  });

  it('gives alice 8 books, bob 2, carol 0, with the Martian trilogy in one series', async () => {
    // 3 Martian + Pride and Prejudice + Sherlock Holmes + Time Machine + Dracula + Frankenstein.
    expect(await prisma.book.count({ where: { userId: alice } })).toBe(8);
    expect(await prisma.book.count({ where: { userId: bob } })).toBe(2);
    expect(await prisma.book.count({ where: { userId: carol } })).toBe(0);

    const martian = await prisma.book.findMany({
      where: {
        userId: alice,
        title: { in: ['A Princess of Mars', 'The Gods of Mars', 'The Warlord of Mars'] },
      },
      orderBy: { seriesIndex: 'asc' },
    });
    expect(martian).toHaveLength(3);
    expect(martian[0].seriesId).toBeTruthy();
    expect(new Set(martian.map((b) => b.seriesId)).size).toBe(1);
    expect(martian.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
  });

  it('derives the odd cases: no cover, a pending fix, a validation warning', async () => {
    const timeMachine = await prisma.book.findFirstOrThrow({
      where: { userId: alice, title: 'The Time Machine' },
    });
    expect(timeMachine.coverData).toBeNull();

    const bobTimeMachine = await prisma.book.findFirstOrThrow({
      where: { userId: bob, title: 'The Time Machine' },
    });
    expect(bobTimeMachine.coverData).not.toBeNull();

    const dracula = await prisma.book.findFirstOrThrow({
      where: { userId: alice, author: 'Bram Stoker' },
    });
    expect(
      await prisma.pendingFix.findUnique({
        where: { userId_bookId: { userId: alice, bookId: dracula.id } },
      })
    ).not.toBeNull();

    const frankenstein = await bookId(prisma, alice, 'Frankenstein');
    const warnings = await prisma.validationMessage.count({
      where: { userId: alice, bookId: frankenstein, severity: 'WARNING' },
    });
    expect(warnings).toBeGreaterThan(0);
  });

  it('rates 4 of alice’s books and records spread-out reading progress', async () => {
    const rated = await prisma.book.findMany({
      where: { userId: alice, ratingOverall: { not: null } },
    });
    expect(rated).toHaveLength(4);
    for (const b of rated) {
      expect(b.ratingStory).not.toBeNull();
      expect(b.ratingCharacters).not.toBeNull();
      expect(b.ratingWriting).not.toBeNull();
      expect(b.ratingIdeas).not.toBeNull();
      expect(b.ratedAt).not.toBeNull();
    }
    const princess = rated.find((b) => b.title === 'A Princess of Mars');
    expect(princess).toMatchObject({
      ratingOverall: 5,
      ratingStory: 5,
      ratingCharacters: 4,
      ratingWriting: 4,
      ratingIdeas: 5,
    });

    const progress = await prisma.progress.findMany({ where: { userId: alice } });
    expect(progress).toHaveLength(4);
    const aliceBookIds = new Set(
      (await prisma.book.findMany({ where: { userId: alice }, select: { id: true } })).map(
        (b) => b.id
      )
    );
    for (const p of progress) {
      expect(aliceBookIds.has(p.document), p.document).toBe(true);
      expect(p.device).toBe('Kobo Libra 2');
      expect(p.deviceId).toBe('demo-kobo-libra-2');
    }
    const byDoc = new Map(progress.map((p) => [p.document, p.percentage]));
    expect(byDoc.get(await bookId(prisma, alice, 'A Princess of Mars'))).toBe(1);
    expect(byDoc.get(await bookId(prisma, alice, 'The Gods of Mars'))).toBe(0.15);
    expect(byDoc.get(await bookId(prisma, alice, 'Pride and Prejudice'))).toBe(0.42);
    expect(byDoc.get(await bookId(prisma, alice, 'The Adventures of Sherlock Holmes'))).toBe(0.7);

    const history = await prisma.progressHistory.findMany({ where: { userId: alice } });
    expect(history.length).toBeGreaterThanOrEqual(8);
    const nowS = Math.floor(NOW / 1000);
    for (const h of history) {
      expect(h.endTimestamp).toBeGreaterThanOrEqual(nowS - 21 * DAY_S);
      expect(h.endTimestamp).toBeLessThanOrEqual(nowS);
    }
  });

  it('creates pending, fulfilled and declined requests', async () => {
    const warlord = await bookId(prisma, alice, 'The Warlord of Mars');
    const aliceRequests = await prisma.bookRequest.findMany({ where: { userId: alice } });
    expect(aliceRequests.map((r) => r.status).sort()).toEqual(['declined', 'fulfilled', 'pending']);
    expect(aliceRequests.find((r) => r.status === 'pending')).toMatchObject({
      title: 'The Wind in the Willows',
      author: 'Kenneth Grahame',
    });
    expect(aliceRequests.find((r) => r.status === 'fulfilled')).toMatchObject({
      title: 'The Warlord of Mars',
      author: 'Edgar Rice Burroughs',
      bookUserId: alice,
      bookId: warlord,
    });
    expect(aliceRequests.find((r) => r.status === 'declined')).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      declineReason: 'Not available as a DRM-free EPUB',
    });

    const bobRequests = await prisma.bookRequest.findMany({ where: { userId: bob } });
    expect(bobRequests).toHaveLength(1);
    expect(bobRequests[0]).toMatchObject({
      title: 'Treasure Island',
      author: 'Robert Louis Stevenson',
      status: 'pending',
    });
  });

  it('creates the Kobo Libra 2 device with alice enabled', async () => {
    const device = await prisma.device.findFirstOrThrow({ where: { name: 'Kobo Libra 2' } });
    const users = await prisma.deviceUser.findMany({ where: { deviceId: device.id } });
    expect(users.map((u) => u.userId)).toContain(alice);
  });

  it('verifies alice’s and bob’s emails and leaves carol without one', async () => {
    const a = await prisma.user.findUniqueOrThrow({ where: { id: alice } });
    const b = await prisma.user.findUniqueOrThrow({ where: { id: bob } });
    const c = await prisma.user.findUniqueOrThrow({ where: { id: carol } });
    expect(a.email).toBe('alice@example.com');
    expect(a.emailVerifiedAt).not.toBeNull();
    expect(b.email).toBe('bob@example.com');
    expect(b.emailVerifiedAt).not.toBeNull();
    expect(c.email).toBeNull();
  });

  it('is repeatable: a second fresh seed at the same time gives the same data', async () => {
    // The shared seed above is the first run; this is the second.
    const second = await freshRoot();
    try {
      await seedFrozen(second);
      expect(await snapshot(second.deps.prisma)).toEqual(await snapshot(prisma));
    } finally {
      await second.cleanup();
    }
  });

  it('throws without a seed password', async () => {
    const config = { ...root.deps.config, seedPassword: undefined };
    await expect(seedDemo({ ...root.deps, config })).rejects.toThrow(/SEED_PASSWORD/);
  });
});
