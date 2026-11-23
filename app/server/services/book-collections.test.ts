import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

import { runMigrations } from '../db/migrate';
import { pruneEmptyCollections, syncBookCollections } from './book-collections';

let prisma: PrismaClient;
let root: string;
let dbPath: string;

async function makeBook(userId: string, id: string): Promise<void> {
  await prisma.book.create({
    data: { userId, id, title: id, author: '', size: 0, mtime: 0, addedAt: 0 },
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-test-'));
  dbPath = path.join(os.tmpdir(), `bc-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  await runMigrations(prisma, root);
  await prisma.user.create({ data: { id: 'u1', username: 'alice' } });
  await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
  await makeBook('u1', 'b1');
  await makeBook('u2', 'b2');
});

afterEach(async () => {
  await prisma.$disconnect();
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

describe('syncBookCollections', () => {
  it('replaces the join rows; prune removes the emptied collection', async () => {
    await prisma.$transaction(async (tx) => {
      await syncBookCollections(tx, 'u1', 'b1', [
        { name: 'A', position: 1 },
        { name: 'B', position: null },
      ]);
      await syncBookCollections(tx, 'u1', 'b1', [{ name: 'B', position: 2 }]);
    });
    const rows = await prisma.bookCollection.findMany({
      where: { userId: 'u1', bookId: 'b1' },
      include: { collection: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].collection.name).toBe('B');
    expect(rows[0].position).toBe(2);
    expect(await prisma.collection.count({ where: { userId: 'u1' } })).toBe(2);

    await prisma.$transaction((tx) => pruneEmptyCollections(tx, 'u1'));
    const left = await prisma.collection.findMany({ where: { userId: 'u1' } });
    expect(left.map((c) => c.name)).toEqual(['B']);
  });

  it('makes separate Collection rows for the same name under two users', async () => {
    await prisma.$transaction(async (tx) => {
      await syncBookCollections(tx, 'u1', 'b1', [{ name: 'Shared', position: null }]);
      await syncBookCollections(tx, 'u2', 'b2', [{ name: 'Shared', position: null }]);
    });
    expect(await prisma.collection.count({ where: { name: 'Shared' } })).toBe(2);
  });
});
