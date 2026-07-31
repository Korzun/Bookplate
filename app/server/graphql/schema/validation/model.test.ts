import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'd'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Broken',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.validation.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      valid: false,
      threshold: 'ERROR',
      validatedAt: 1_700_000_000_000,
      messages: {
        // Inserted out of seq order deliberately: seq 1 first, seq 0 second.
        // The resolver must sort by seq, not return insertion/rowid order.
        create: [
          {
            seq: 1,
            code: 'RSC-006',
            severity: 'WARNING',
            message: 'second',
            path: 'OEBPS/y.xhtml',
            line: 9,
            column: 3,
          },
          {
            seq: 0,
            code: 'RSC-005',
            severity: 'ERROR',
            message: 'bad',
            path: 'OEBPS/x.xhtml',
            line: 4,
            column: 2,
          },
        ],
      },
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Book.validation', () => {
  it('exposes the stored validation with its messages', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { validation { valid threshold validatedAt messages { code severity message path line column } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const validation = (
      result.data as {
        viewer: { library: { book: { validation: { valid: boolean; messages: unknown[] } } } };
      }
    ).viewer.library.book.validation;
    expect(validation.valid).toBe(false);
    // Seeded with seq 1 inserted before seq 0, so this documents the intended
    // seq order. It does NOT by itself prove the resolver's `orderBy` clause
    // is load-bearing — see the next test and its comment for why, and for
    // the assertion that actually discriminates a missing `orderBy`.
    expect(validation.messages).toEqual([
      {
        code: 'RSC-005',
        severity: 'ERROR',
        message: 'bad',
        path: 'OEBPS/x.xhtml',
        line: 4,
        column: 2,
      },
      {
        code: 'RSC-006',
        severity: 'WARNING',
        message: 'second',
        path: 'OEBPS/y.xhtml',
        line: 9,
        column: 3,
      },
    ]);
  });

  it('sends an explicit seq ORDER BY to Prisma for messages', async () => {
    // `validation_messages` has a compound PRIMARY KEY of (user_id, book_id,
    // seq), so SQLite serves an equality lookup on (user_id, book_id) off the
    // auto-created PK index and returns matching rows in ascending key
    // order — i.e. by seq — regardless of insertion order and regardless of
    // whether an application-level ORDER BY is present at all. Verified
    // directly: raw `SELECT ... WHERE user_id = ? AND book_id = ?` with no
    // ORDER BY, against rows inserted in scrambled seq order (4, 1, 3, 0, 2),
    // still came back as 0, 1, 2, 3, 4. That means no seed fixture, however
    // scrambled, can make a row-order assertion fail if the resolver's
    // `orderBy: { seq: 'asc' }` were removed — the database's own storage
    // order already matches it. So this test asserts on the actual query
    // Pothos sends to Prisma instead of on the returned rows: it fails if
    // the `orderBy` clause is dropped from `validation/model.ts`, and passes
    // when it's present, regardless of what SQLite would have returned
    // anyway.
    const findUniqueSpy = vi.spyOn(harness.prisma.book, 'findUnique');

    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { validation { messages { seq } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(findUniqueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          validation: expect.objectContaining({
            include: expect.objectContaining({
              messages: expect.objectContaining({ orderBy: { seq: 'asc' } }),
            }),
          }),
        }),
      })
    );
  });

  it('is null for a book that has never been validated', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: 'e'.repeat(32),
        title: 'Fresh',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'e'.repeat(32)}") { validation { valid } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { validation: unknown } } } }).viewer.library
        .book.validation ?? null
    ).toBeNull();
  });
});
