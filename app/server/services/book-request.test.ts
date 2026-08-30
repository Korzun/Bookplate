import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  createBookRequest,
  declineBookRequest,
  dedupeKey,
  deleteBookRequest,
  fulfillBookRequest,
  MAX_OPEN_BOOK_REQUESTS,
} from './book-request';

vi.mock('../logger');

let tmpDir: string;
let prisma: PrismaClient;
const ALICE = 'user-alice';

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-request-'));
  const booksDir = path.join(tmpDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(tmpDir, 'db.sqlite')}`);
  await runMigrations(prisma, booksDir);
  await prisma.user.create({ data: { id: ALICE, username: 'alice' } });
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const input = (overrides: Partial<Parameters<typeof createBookRequest>[1]> = {}) => ({
  userId: ALICE,
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  ...overrides,
});

describe('dedupeKey', () => {
  it('folds case, collapses whitespace, and trims', () => {
    expect(dedupeKey('  The   DUNE ', 'Frank  Herbert')).toBe('the dune\0frank herbert');
  });

  it('separates the halves so a title cannot impersonate an author', () => {
    expect(dedupeKey('a b', 'c')).not.toBe(dedupeKey('a', 'b c'));
  });
});

describe('createBookRequest', () => {
  it('creates a pending request and returns its id', async () => {
    const outcome = await createBookRequest(prisma, input());
    expect(outcome.kind).toBe('created');

    const rows = await prisma.bookRequest.findMany({ where: { userId: ALICE } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      status: 'pending',
      dedupeKey: 'dune\0frank herbert',
    });
  });

  it('rejects a second OPEN request for the same title and author, case-insensitively', async () => {
    const first = await createBookRequest(prisma, input());
    const second = await createBookRequest(
      prisma,
      input({ title: 'dune', author: 'FRANK HERBERT' })
    );

    expect(second).toEqual({
      kind: 'duplicate',
      existingId: first.kind === 'created' ? first.id : '',
    });
    expect(await prisma.bookRequest.count()).toBe(1);
  });

  it('allows re-requesting a book whose earlier request was declined', async () => {
    const first = await createBookRequest(prisma, input());
    if (first.kind !== 'created') throw new Error('setup failed');
    await prisma.bookRequest.update({
      where: { userId_id: { userId: ALICE, id: first.id } },
      data: { status: 'declined' },
    });

    const second = await createBookRequest(prisma, input());
    expect(second.kind).toBe('created');
  });

  it('accepts the 10th open request and refuses the 11th', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      const outcome = await createBookRequest(prisma, input({ title: `Book ${n}` }));
      expect(outcome.kind).toBe('created');
    }

    const overflow = await createBookRequest(prisma, input({ title: 'One too many' }));
    expect(overflow).toEqual({ kind: 'limit', limit: MAX_OPEN_BOOK_REQUESTS });
    expect(await prisma.bookRequest.count()).toBe(MAX_OPEN_BOOK_REQUESTS);
  });

  it('does not count resolved requests against the cap', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      await createBookRequest(prisma, input({ title: `Book ${n}` }));
    }
    await prisma.bookRequest.updateMany({
      where: { userId: ALICE, title: 'Book 0' },
      data: { status: 'fulfilled' },
    });

    const outcome = await createBookRequest(prisma, input({ title: 'Now there is room' }));
    expect(outcome.kind).toBe('created');
  });

  it('trims the stored strings', async () => {
    await createBookRequest(
      prisma,
      input({ title: '  Dune  ', author: ' Frank Herbert ', note: ' please ' })
    );
    const row = await prisma.bookRequest.findFirstOrThrow({ where: { userId: ALICE } });
    expect(row).toMatchObject({ title: 'Dune', author: 'Frank Herbert', note: 'please' });
  });
});

const BOB = 'user-bob';
const seedBook = async (userId: string, id: string) => {
  await prisma.book.create({
    data: { userId, id, title: 'Dune', size: 1, mtime: 0, addedAt: 0 },
  });
};
const seedRequest = async (): Promise<string> => {
  const outcome = await createBookRequest(prisma, input());
  if (outcome.kind !== 'created') throw new Error('setup failed');
  return outcome.id;
};

describe('fulfillBookRequest', () => {
  it('marks the request fulfilled and links the book', async () => {
    const id = await seedRequest();
    await seedBook(ALICE, 'a'.repeat(32));

    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: ALICE,
      bookId: 'a'.repeat(32),
    });

    expect(outcome).toEqual({ kind: 'resolved' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row.status).toBe('fulfilled');
    expect(row.bookId).toBe('a'.repeat(32));
    expect(row.resolvedAt).not.toBeNull();
  });

  it('refuses a book from a different library', async () => {
    const id = await seedRequest();
    await prisma.user.create({ data: { id: BOB, username: 'bob' } });
    await seedBook(BOB, 'b'.repeat(32));

    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: BOB,
      bookId: 'b'.repeat(32),
    });

    expect(outcome).toEqual({ kind: 'noSuchBook' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row.status).toBe('pending');
  });

  it('refuses a book that does not exist', async () => {
    const id = await seedRequest();
    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: ALICE,
      bookId: 'c'.repeat(32),
    });
    expect(outcome).toEqual({ kind: 'noSuchBook' });
  });

  it('reports a missing request', async () => {
    const outcome = await fulfillBookRequest(prisma, {
      userId: ALICE,
      id: 'no-such-request',
      bookUserId: ALICE,
      bookId: 'a'.repeat(32),
    });
    expect(outcome).toEqual({ kind: 'missing' });
  });

  it('refuses to resolve an already-resolved request', async () => {
    const id = await seedRequest();
    await seedBook(ALICE, 'a'.repeat(32));
    await fulfillBookRequest(prisma, {
      userId: ALICE,
      id,
      bookUserId: ALICE,
      bookId: 'a'.repeat(32),
    });

    const again = await declineBookRequest(prisma, {
      userId: ALICE,
      id,
      reason: 'changed my mind',
    });
    expect(again).toEqual({ kind: 'notPending', status: 'fulfilled' });
  });
});

describe('declineBookRequest', () => {
  it('marks the request declined and records the reason', async () => {
    const id = await seedRequest();
    const outcome = await declineBookRequest(prisma, {
      userId: ALICE,
      id,
      reason: "Can't find it",
    });

    expect(outcome).toEqual({ kind: 'resolved' });
    const row = await prisma.bookRequest.findUniqueOrThrow({
      where: { userId_id: { userId: ALICE, id } },
    });
    expect(row).toMatchObject({ status: 'declined', declineReason: "Can't find it" });
    expect(row.resolvedAt).not.toBeNull();
  });

  it('reports a missing request', async () => {
    const outcome = await declineBookRequest(prisma, { userId: ALICE, id: 'nope', reason: '' });
    expect(outcome).toEqual({ kind: 'missing' });
  });
});

describe('deleteBookRequest', () => {
  it('deletes the row and reports true', async () => {
    const id = await seedRequest();
    expect(await deleteBookRequest(prisma, { userId: ALICE, id })).toBe(true);
    expect(await prisma.bookRequest.count()).toBe(0);
  });

  it('reports false for a row that is not there', async () => {
    expect(await deleteBookRequest(prisma, { userId: ALICE, id: 'nope' })).toBe(false);
  });
});
