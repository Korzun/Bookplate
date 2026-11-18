/**
 * Seeds the preview deploy's demo data set: readers `alice`, `bob` and
 * `carol`, real EPUB imports through `importEpub` (so validation reports and
 * pending fixes are what the pipeline produces), ratings, backdated reading
 * progress, book requests in every state, and one device.
 *
 * Expects an empty database and library (`resetDemoDirs` + migrations run
 * first). Every step that can fail throws, so a half-seeded preview never
 * serves.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { getStagingDir } from '../services/book-paths';
import {
  createBookRequest,
  declineBookRequest,
  fulfillBookRequest,
} from '../services/book-request';
import { createDevice } from '../services/device';
import { markEmailVerified, setUserEmail } from '../services/email';
import { importEpub, type ImportEpubDeps } from '../services/import-epub';
import { hashLoginPassword } from '../services/password';
import { saveProgress } from '../services/progress';
import { createUser } from '../services/user';
import type { Owner } from '../types';
import {
  deriveAllCapsTitle,
  deriveNoCover,
  deriveWithWarning,
  demoFixturesDir,
  FIXTURES,
} from './fixtures';

export type DemoSeedSummary = {
  users: string[];
  /** username → book ids, in import order. */
  books: Record<string, string[]>;
};

type FixtureKey = keyof typeof FIXTURES;
type Derive = (src: string, dest: string) => void;
type Rating = [overall: number, story: number, characters: number, writing: number, ideas: number];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const DEVICE_NAME = 'Kobo Libra 2';
const DEVICE_ID = 'demo-kobo-libra-2';

const copy: Derive = (src, dest) => fs.copyFileSync(src, dest);

const ALICE_BOOKS: [FixtureKey, Derive][] = [
  ['princessOfMars', copy],
  ['godsOfMars', copy],
  ['warlordOfMars', copy],
  ['prideAndPrejudice', copy],
  ['sherlockHolmes', copy],
  ['timeMachine', deriveNoCover],
  ['dracula', deriveAllCapsTitle],
  ['frankenstein', deriveWithWarning],
];

const BOB_BOOKS: [FixtureKey, Derive][] = [
  ['prideAndPrejudice', copy],
  ['timeMachine', copy],
];

const ALICE_RATINGS: [FixtureKey, Rating][] = [
  ['princessOfMars', [5, 5, 4, 4, 5]],
  ['prideAndPrejudice', [5, 4, 5, 5, 4]],
  ['sherlockHolmes', [4, 4, 4, 4, 3]],
  ['godsOfMars', [3, 4, 3, 3, 3]],
];

/**
 * Reading sessions as [days ago, percentage], oldest first so the last save
 * is the current position. Sessions are days apart, far beyond `saveProgress`'s
 * 600 s merge window, so each one is its own `ProgressHistory` row.
 */
const ALICE_READING: [FixtureKey, [daysAgo: number, percentage: number][]][] = [
  [
    'princessOfMars',
    [
      [20, 0.2],
      [16, 0.5],
      [12, 0.8],
      [9, 1],
    ],
  ],
  [
    'sherlockHolmes',
    [
      [18, 0.2],
      [10, 0.4],
      [4, 0.55],
      [1, 0.7],
    ],
  ],
  [
    'prideAndPrejudice',
    [
      [14, 0.1],
      [7, 0.25],
      [3, 0.42],
    ],
  ],
  [
    'godsOfMars',
    [
      [5, 0.05],
      [2, 0.15],
    ],
  ],
];

/** A KOReader-style xpointer roughly matching the percentage. */
const xpointer = (percentage: number): string =>
  `/body/DocFragment[${Math.max(1, Math.round(percentage * 40))}]/body/p[1]/text().0`;

async function seedUser(
  prisma: PrismaClient,
  username: string,
  passwordHash: string,
  email: string | null,
  now: number
): Promise<Owner> {
  if (!(await createUser(prisma, username, passwordHash, undefined, false))) {
    throw new Error(`Demo seed: user "${username}" already exists`);
  }
  const { id: userId } = await prisma.user.findUniqueOrThrow({
    where: { username },
    select: { id: true },
  });
  if (email !== null) {
    const result = await setUserEmail(prisma, userId, email);
    if (!result.ok)
      throw new Error(`Demo seed: email for "${username}" rejected: ${result.reason}`);
    await markEmailVerified(prisma, userId, now);
  }
  return { userId, username };
}

async function importFixtures(
  deps: ImportEpubDeps,
  owner: Owner,
  fixturesDir: string,
  books: [FixtureKey, Derive][]
): Promise<Map<FixtureKey, string>> {
  const stagingDir = getStagingDir(deps.config.booksDir);
  fs.mkdirSync(stagingDir, { recursive: true });
  const ids = new Map<FixtureKey, string>();
  for (const [key, derive] of books) {
    const originalName = FIXTURES[key];
    const staged = path.join(stagingDir, `demo-${owner.username}-${randomUUID()}-${originalName}`);
    derive(path.join(fixturesDir, originalName), staged);
    const result = await importEpub(deps, owner, {
      path: staged,
      originalName,
      size: fs.statSync(staged).size,
    });
    if (result.kind !== 'imported') {
      const detail = 'message' in result ? `: ${result.message}` : '';
      throw new Error(
        `Demo seed: importing ${originalName} for ${owner.username} gave ${result.kind}${detail}`
      );
    }
    if (key === 'dracula' && result.proposals.length === 0) {
      throw new Error(
        `Demo seed: importing ${originalName} for ${owner.username} produced no pending metadata fix`
      );
    }
    ids.set(key, result.bookId);
  }
  return ids;
}

async function requestBook(
  prisma: PrismaClient,
  owner: Owner,
  title: string,
  author: string
): Promise<string> {
  const outcome = await createBookRequest(prisma, {
    userId: owner.userId,
    title,
    author,
    note: '',
  });
  if (outcome.kind !== 'created') {
    throw new Error(`Demo seed: request "${title}" for ${owner.username} gave ${outcome.kind}`);
  }
  return outcome.id;
}

function assertResolved(outcome: { kind: string }, what: string): void {
  if (outcome.kind !== 'resolved') throw new Error(`Demo seed: ${what} gave ${outcome.kind}`);
}

export async function seedDemo(
  deps: ImportEpubDeps,
  opts: { now?: number; fixturesDir?: string } = {}
): Promise<DemoSeedSummary> {
  const { prisma, config } = deps;
  if (!config.seedPassword) throw new Error('Demo seed requires SEED_PASSWORD');
  const now = opts.now ?? Date.now();
  const fixturesDir = opts.fixturesDir ?? demoFixturesDir();

  // One hash for all three: they share SEED_PASSWORD, and hashing is slow.
  const passwordHash = await hashLoginPassword(config.seedPassword);
  const alice = await seedUser(prisma, 'alice', passwordHash, 'alice@example.com', now);
  const bob = await seedUser(prisma, 'bob', passwordHash, 'bob@example.com', now);
  await seedUser(prisma, 'carol', passwordHash, null, now);

  const aliceBooks = await importFixtures(deps, alice, fixturesDir, ALICE_BOOKS);
  const bobBooks = await importFixtures(deps, bob, fixturesDir, BOB_BOOKS);
  const aliceBook = (key: FixtureKey): string => aliceBooks.get(key)!;

  // Ratings and device access have no write service (global constraints).
  for (const [i, [key, [overall, story, characters, writing, ideas]]] of ALICE_RATINGS.entries()) {
    await prisma.book.update({
      where: { userId_id: { userId: alice.userId, id: aliceBook(key) } },
      data: {
        ratingOverall: overall,
        ratingStory: story,
        ratingCharacters: characters,
        ratingWriting: writing,
        ratingIdeas: ideas,
        ratedAt: now - (8 - i) * DAY_MS,
      },
    });
  }

  for (const [key, sessions] of ALICE_READING) {
    for (const [daysAgo, percentage] of sessions) {
      // 2–6 hours before the day mark (always in the past), so sessions vary by book.
      const at = now - daysAgo * DAY_MS + (key.length % 5) * HOUR_MS - 6 * HOUR_MS;
      await saveProgress(prisma, alice.userId, {
        document: aliceBook(key),
        progress: xpointer(percentage),
        percentage,
        device: DEVICE_NAME,
        device_id: DEVICE_ID,
        timestamp: Math.floor(at / 1000),
      });
    }
  }

  await requestBook(prisma, alice, 'The Wind in the Willows', 'Kenneth Grahame');
  const warlordRequest = await requestBook(
    prisma,
    alice,
    'The Warlord of Mars',
    'Edgar Rice Burroughs'
  );
  assertResolved(
    await fulfillBookRequest(prisma, {
      userId: alice.userId,
      id: warlordRequest,
      bookUserId: alice.userId,
      bookId: aliceBook('warlordOfMars'),
      actor: 'admin',
    }),
    'fulfilling "The Warlord of Mars"'
  );
  const duneRequest = await requestBook(prisma, alice, 'Dune', 'Frank Herbert');
  assertResolved(
    await declineBookRequest(prisma, {
      userId: alice.userId,
      id: duneRequest,
      reason: 'Not available as a DRM-free EPUB',
    }),
    'declining "Dune"'
  );
  await requestBook(prisma, bob, 'Treasure Island', 'Robert Louis Stevenson');

  // Defaults match the device form's (app/client device-form): no size, contain, colour, no simplify.
  const deviceId = await createDevice(prisma, {
    name: DEVICE_NAME,
    coverWidth: null,
    coverHeight: null,
    coverFit: 'contain',
    bwCover: false,
    simplify: false,
  });
  await prisma.deviceUser.create({ data: { deviceId, userId: alice.userId } });

  return {
    users: ['alice', 'bob', 'carol'],
    books: { alice: [...aliceBooks.values()], bob: [...bobBooks.values()], carol: [] },
  };
}
