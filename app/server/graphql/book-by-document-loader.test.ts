import { describe, expect, it, vi } from 'vitest';

import { createBookByDocumentLoader } from './book-by-document-loader';

type BookRow = { userId: string; id: string; title: string };

const prismaWith = (rows: BookRow[], findMany = vi.fn().mockResolvedValue(rows)) => ({
  prisma: { book: { findMany } } as never,
  findMany,
});

describe('createBookByDocumentLoader', () => {
  it('batches every pending lookup into ONE findMany call', async () => {
    const { prisma, findMany } = prismaWith([
      { userId: 'u1', id: 'doc-a', title: 'A' },
      { userId: 'u1', id: 'doc-b', title: 'B' },
    ]);
    const load = createBookByDocumentLoader(prisma);

    const [a, b] = await Promise.all([load('u1', 'doc-a'), load('u1', 'doc-b')]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(a?.title).toBe('A');
    expect(b?.title).toBe('B');
  });

  it('resolves null for a document with no book in the library', async () => {
    const { prisma } = prismaWith([]);
    const load = createBookByDocumentLoader(prisma);

    await expect(load('u1', 'not-in-library')).resolves.toBeNull();
  });

  it('scopes by (userId, document) PAIRS, never a bare document IN (...)', async () => {
    const { prisma, findMany } = prismaWith([]);
    const load = createBookByDocumentLoader(prisma);

    await Promise.all([load('u1', 'doc-a'), load('u2', 'doc-a')]);

    const where = findMany.mock.calls[0][0].where as { OR: unknown[] };
    expect(where.OR).toEqual([
      { userId: 'u1', id: 'doc-a' },
      { userId: 'u2', id: 'doc-a' },
    ]);
  });

  it('does not leak one tenant’s book to another asking for the same hash', async () => {
    const { prisma } = prismaWith([{ userId: 'u1', id: 'shared-hash', title: 'Alice copy' }]);
    const load = createBookByDocumentLoader(prisma);

    const [alice, bob] = await Promise.all([load('u1', 'shared-hash'), load('u2', 'shared-hash')]);

    expect(alice?.title).toBe('Alice copy');
    expect(bob).toBeNull();
  });

  it('REJECTS every pending lookup when the query throws — never hangs the request', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('db down'));
    const load = createBookByDocumentLoader({ book: { findMany } } as never);

    await expect(Promise.all([load('u1', 'a'), load('u1', 'b')])).rejects.toThrow('db down');
  });

  it('memoizes per key: a repeat lookup issues no second query', async () => {
    const { prisma, findMany } = prismaWith([{ userId: 'u1', id: 'doc-a', title: 'A' }]);
    const load = createBookByDocumentLoader(prisma);

    await load('u1', 'doc-a');
    await load('u1', 'doc-a');

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
