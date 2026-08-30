import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from '../db/client';
import { runMigrations } from '../db/migrate';
import {
  createBookRequest,
  dedupeKey,
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
    const second = await createBookRequest(prisma, input({ title: 'dune', author: 'FRANK HERBERT' }));

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
    await createBookRequest(prisma, input({ title: '  Dune  ', author: ' Frank Herbert ', note: ' please ' }));
    const row = await prisma.bookRequest.findFirstOrThrow({ where: { userId: ALICE } });
    expect(row).toMatchObject({ title: 'Dune', author: 'Frank Herbert', note: 'please' });
  });
});
