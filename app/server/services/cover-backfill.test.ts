import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient, Prisma } from '@prisma/client';
import sharp from 'sharp';

import { runMigrations } from '../db/migrate';
import { seedBook } from '../test-support/seed-book';
import { EpubMeta, Owner } from '../types';
import { getThumbnail, saveThumbnail } from './book-assets';
import { CoverBackfill } from './cover-backfill';
import { normalizeCover } from './cover-normalize';

vi.mock('../logger');

const OWNER: Owner = { userId: 'usr_test000000000000000', username: 'alice' };

const FAKE_META: EpubMeta = {
  title: 'Test',
  author: 'Author',
  description: '',
  publisher: '',
  series: '',
  seriesIndex: 0,
  titleSort: '',
  authorSort: '',
  publishDate: '',
  identifiers: [],
  subjects: [],
  coverData: Buffer.from('fake-cover-bytes'),
  coverMime: 'image/jpeg',
  chapterCount: 0,
  chapterSpineMap: [],
  chapterNames: [],
  pageCount: 0,
};

const png = () =>
  sharp({
    create: { width: 40, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
const baselineJpeg = () =>
  sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 200, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();

function stage(id: string): string {
  const p = path.join(booksDir, `staged-${id}.epub`);
  fs.writeFileSync(p, 'x');
  return p;
}

/**
 * Simulates a row written before normalization existed: whatever bytes/MIME
 * the caller gives, with the marker column at its migration default.
 */
async function legacyRow(id: string, coverData: Buffer | null, coverMime: string | null) {
  await seedBook(prisma, { booksRoot }, OWNER, id, stage(id), FAKE_META);
  await prisma.book.update({
    where: { userId_id: { userId: OWNER.userId, id } },
    data: {
      coverData: coverData as unknown as Prisma.Bytes | null,
      coverMime,
      coverNormalized: false,
    },
  });
}

async function storedCover(id: string) {
  const row = await prisma.book.findUniqueOrThrow({
    where: { userId_id: { userId: OWNER.userId, id } },
    select: { coverData: true, coverMime: true, coverNormalized: true },
  });
  return {
    data: row.coverData === null ? null : Buffer.from(row.coverData),
    mime: row.coverMime,
    normalized: row.coverNormalized,
  };
}

let prisma: PrismaClient;
let booksRoot: string;
let booksDir: string;
let dbPath: string;
const enqueue = vi.fn<(userId: string, bookId: string) => void>();
const normalize = vi.fn(normalizeCover);

beforeEach(async () => {
  booksRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-backfill-test-'));
  booksDir = path.join(booksRoot, OWNER.username);
  fs.mkdirSync(booksDir, { recursive: true });
  dbPath = path.join(
    os.tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  );
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, booksRoot);
  await prisma.user.create({ data: { id: OWNER.userId, username: OWNER.username } });
});

afterEach(async () => {
  await prisma.$disconnect();
  try {
    fs.unlinkSync(dbPath);
  } catch {
    /* best-effort cleanup */
  }
  fs.rmSync(booksRoot, { recursive: true });
});

const backfill = () => new CoverBackfill(prisma, { enqueue }, { normalize, delayMs: 0 });

describe('CoverBackfill.run', () => {
  it('re-encodes a non-JPEG cover, drops its thumbnails and enqueues regeneration', async () => {
    await legacyRow('bk-png', await png(), 'image/png');
    await saveThumbnail(prisma, OWNER.userId, 'bk-png', 150, Buffer.from('stale'), 'image/jpeg');

    const result = await backfill().run();

    const stored = await storedCover('bk-png');
    expect(stored.mime).toBe('image/jpeg');
    expect(stored.normalized).toBe(true);
    expect((await sharp(stored.data!).metadata()).format).toBe('jpeg');
    expect(await getThumbnail(prisma, OWNER.userId, 'bk-png', 150)).toBeNull();
    expect(enqueue).toHaveBeenCalledWith(OWNER.userId, 'bk-png');
    expect(result).toEqual({ checked: 1, reencoded: 1, undecodable: 0 });
  });

  it('catches a progressive JPEG already stored as image/jpeg', async () => {
    const progressive = await sharp({
      create: { width: 40, height: 60, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .jpeg({ progressive: true })
      .toBuffer();
    await legacyRow('bk-prog', progressive, 'image/jpeg');

    await backfill().run();

    const stored = await storedCover('bk-prog');
    expect(stored.normalized).toBe(true);
    expect((await sharp(stored.data!).metadata()).isProgressive).toBe(false);
    expect(enqueue).toHaveBeenCalledWith(OWNER.userId, 'bk-prog');
  });

  it('flips the marker for a legacy baseline JPEG without rewriting bytes or thumbnails', async () => {
    const jpeg = await baselineJpeg();
    await legacyRow('bk-jpg', jpeg, 'image/jpeg');
    await saveThumbnail(prisma, OWNER.userId, 'bk-jpg', 150, Buffer.from('keep'), 'image/jpeg');

    const result = await backfill().run();

    const stored = await storedCover('bk-jpg');
    expect(stored.data!.equals(jpeg)).toBe(true);
    expect(stored.normalized).toBe(true);
    const thumb = await getThumbnail(prisma, OWNER.userId, 'bk-jpg', 150);
    expect(Buffer.from(thumb!.data).toString()).toBe('keep');
    expect(enqueue).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, reencoded: 0, undecodable: 0 });
  });

  it('skips rows already normalized and rows without a cover', async () => {
    // addBook normalizes on the way in, so this row is already marked.
    await seedBook(prisma, { booksRoot }, OWNER, 'bk-done', stage('bk-done'), {
      ...FAKE_META,
      coverData: await png(),
      coverMime: 'image/png',
    });
    expect((await storedCover('bk-done')).normalized).toBe(true);
    await legacyRow('bk-none', null, null);
    normalize.mockClear();

    const result = await backfill().run();

    expect(normalize).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, reencoded: 0, undecodable: 0 });
  });

  it('leaves an undecodable cover unnormalized and continues with the next row', async () => {
    await legacyRow('bk-bad', Buffer.from('not-an-image'), 'image/jpeg');
    await legacyRow('bk-ok', await png(), 'image/png');

    const result = await backfill().run();

    const bad = await storedCover('bk-bad');
    expect(bad.data!.toString()).toBe('not-an-image');
    expect(bad.normalized).toBe(false);
    expect((await storedCover('bk-ok')).normalized).toBe(true);
    expect(result).toEqual({ checked: 2, reencoded: 1, undecodable: 1 });
  });

  it('is idempotent: a second run has nothing to do', async () => {
    await legacyRow('bk-twice', await png(), 'image/png');
    await backfill().run();
    normalize.mockClear();
    enqueue.mockClear();

    const result = await backfill().run();

    expect(normalize).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, reencoded: 0, undecodable: 0 });
  });

  it('does not overwrite a cover that was rewritten while it was being normalized', async () => {
    await legacyRow('bk-race', await png(), 'image/png');
    const replacement = await baselineJpeg();
    // A reimport (metadata save / cover replace) lands between the backfill's
    // read and its write: it stores its own normalized cover and marks the row.
    normalize.mockImplementationOnce(async (data, mime) => {
      await prisma.book.update({
        where: { userId_id: { userId: OWNER.userId, id: 'bk-race' } },
        data: {
          coverData: replacement as unknown as Prisma.Bytes,
          coverMime: 'image/jpeg',
          coverNormalized: true,
        },
      });
      return normalizeCover(data, mime);
    });

    await backfill().run();

    const stored = await storedCover('bk-race');
    expect(stored.data!.equals(replacement)).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('stop() ends the run between rows', async () => {
    await legacyRow('bk-s1', await png(), 'image/png');
    await legacyRow('bk-s2', await png(), 'image/png');
    const b = backfill();
    normalize.mockImplementationOnce(async (data, mime) => {
      b.stop();
      return normalizeCover(data, mime);
    });

    const result = await b.run();

    expect(result.checked).toBe(1);
    expect(
      [await storedCover('bk-s1'), await storedCover('bk-s2')].filter((c) => c.normalized)
    ).toHaveLength(1);
  });
});
