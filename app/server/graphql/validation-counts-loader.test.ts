import { describe, expect, it, vi } from 'vitest';

import { createValidationCountsLoader } from './validation-counts-loader';

type GroupRow = { userId: string; bookId: string; severity: string; _count: { _all: number } };

const prismaWith = (rows: GroupRow[], groupBy = vi.fn().mockResolvedValue(rows)) => ({
  prisma: { validationMessage: { groupBy } } as never,
  groupBy,
});

describe('createValidationCountsLoader', () => {
  it('batches every pending lookup into ONE groupBy call', async () => {
    const { prisma, groupBy } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'ERROR', _count: { _all: 2 } },
      { userId: 'u1', bookId: 'b2', severity: 'WARNING', _count: { _all: 5 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    const [first, second] = await Promise.all([load('u1', 'b1'), load('u1', 'b2')]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(first).toEqual([{ severity: 'ERROR', count: 2 }]);
    expect(second).toEqual([{ severity: 'WARNING', count: 5 }]);
  });

  it('omits zero-count severities rather than reporting them as 0', async () => {
    const { prisma } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'FATAL', _count: { _all: 1 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    const counts = await load('u1', 'b1');

    expect(counts).toEqual([{ severity: 'FATAL', count: 1 }]);
    expect(counts.map((c) => c.severity)).not.toContain('ERROR');
  });

  it('resolves an empty list for a book with no messages', async () => {
    const { prisma } = prismaWith([]);
    const load = createValidationCountsLoader(prisma);

    await expect(load('u1', 'b1')).resolves.toEqual([]);
  });

  it('scopes by (userId, bookId) PAIRS, never a bare bookId IN (...)', async () => {
    const { prisma, groupBy } = prismaWith([]);
    const load = createValidationCountsLoader(prisma);

    await Promise.all([load('u1', 'b1'), load('u2', 'b1')]);

    const where = groupBy.mock.calls[0][0].where as { OR: unknown[] };
    expect(where.OR).toEqual([
      { userId: 'u1', bookId: 'b1' },
      { userId: 'u2', bookId: 'b1' },
    ]);
  });

  it('REJECTS every pending lookup when the query throws — never hangs the request', async () => {
    const groupBy = vi.fn().mockRejectedValue(new Error('db down'));
    const load = createValidationCountsLoader({ validationMessage: { groupBy } } as never);

    await expect(Promise.all([load('u1', 'b1'), load('u1', 'b2')])).rejects.toThrow('db down');
  });

  it('memoizes per key: a repeat lookup issues no second query', async () => {
    const { prisma, groupBy } = prismaWith([
      { userId: 'u1', bookId: 'b1', severity: 'INFO', _count: { _all: 3 } },
    ]);
    const load = createValidationCountsLoader(prisma);

    await load('u1', 'b1');
    await load('u1', 'b1');

    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});
