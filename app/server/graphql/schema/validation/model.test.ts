import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'd'.repeat(32);

// Computed the same way the resolver decodes/re-encodes it — mirrors
// `pending-fix/model.test.ts`'s identical helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { validation { valid threshold validatedAt messages { edges { node { code severity message path line column } } } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const validation = (
      result.data as {
        viewer: {
          library: {
            book: {
              validation: {
                valid: boolean;
                threshold: string;
                messages: { edges: { node: unknown }[] };
              };
            };
          };
        };
      }
    ).viewer.library.book.validation;
    expect(validation.valid).toBe(false);
    // Round-trip for ValidationThreshold: stored 'ERROR' -> wire 'ERROR'. Names
    // and stored values coincide for this enum, so this cannot discriminate a
    // missed retype — see ValidationSeverity's messages assertion below for the
    // same non-discriminating shape, and CoverFit/SuggestionType/LineageType
    // elsewhere for the genuinely discriminating cases.
    expect(validation.threshold).toBe('ERROR');
    // Seeded with seq 1 inserted before seq 0, so this documents the intended
    // seq order. It does NOT by itself prove the resolver's `orderBy` clause
    // is load-bearing — see the next test and its comment for why, and for
    // the assertion that actually discriminates a missing `orderBy`.
    expect(validation.messages.edges.map((e) => e.node)).toEqual([
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
    // Pothos sends to Prisma instead of on the returned rows.
    //
    // Re-pointed for `t.relatedConnection` (was `t.relation`): `messages` is
    // now `Validation.messages(first: ...)`, so the nested `include` gains
    // `take`/`skip` (the connection's page-size machinery) alongside the same
    // `orderBy` — this still asserts on the same nested-include path Pothos
    // plans for the eagerly-selected `book -> validation -> messages` chain,
    // just with `objectContaining` tolerating the extra pagination keys.
    // Verified both directions: with `orderBy: { seq: 'asc' }` removed from
    // `validation/model.ts`, this assertion fails (`toHaveBeenCalledWith`
    // reports no matching call); restored, it passes.
    const findUniqueSpy = vi.spyOn(harness.prisma.book, 'findUnique');

    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { validation { messages(first: 10) { edges { node { seq } } } } } } } }`,
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

  // `Validation.id` byte-identical to the sibling `Book.id` in one selection
  // (design doc §1, `BookDeletePayload.deletedId`'s exact construction).
  it("exposes id byte-identical to its owning Book's id", async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { id validation { id } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const bookField = (
      result.data as { viewer: { library: { book: { id: string; validation: { id: string } } } } }
    ).viewer.library.book;
    expect(bookField.validation.id).toBe(bookField.id);
    expect(bookField.validation.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
  });

  // Admin-traversal-discriminating: same reasoning as `pending-fix/model.
  // test.ts`'s identical test — a self-read cannot tell "reads userId/bookId
  // off the row" apart from "substitutes context.viewer!.userId", since alice
  // reading her own validation makes both readings equal. The admin's
  // `userId` is `null`, so a viewer-derived `id` would diverge from the
  // sibling `Book.id`.
  it('reads userId/bookId off its own row under admin traversal — id still matches the sibling Book.id', async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { id validation { id } } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const bookField = (
      result.data as { user: { library: { book: { id: string; validation: { id: string } } } } }
    ).user.library.book;
    expect(bookField.validation.id).toBe(bookField.id);
    expect(bookField.validation.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, 'e'.repeat(32))}") { validation { valid } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { validation: unknown } } } }).viewer.library
        .book.validation ?? null
    ).toBeNull();
  });
});

describe('Validation.messages connection', () => {
  const MANY_BOOK_ID = 'e'.repeat(32);

  type MessagesPage = {
    edges: { cursor: string; node: { seq: number } }[];
  };
  type MessagesData = {
    viewer: { library: { book: { validation: { messages: MessagesPage } } } };
  };

  // A function, not a module-level constant: the gid embeds `harness.
  // aliceOwner.userId`, which does not exist until the (module-level)
  // `beforeEach` above has run — unlike the raw local id this replaced,
  // which was a fixed literal available at module load time.
  const pageQuery = (gid: string): string => `
    query ($first: Int, $after: String, $last: Int, $before: String) {
      viewer { library { book(id: "${gid}") { validation {
        messages(first: $first, after: $after, last: $last, before: $before) {
          edges { cursor node { seq } }
          pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
        }
      } } } }
    }
  `;

  const readMessages = async (variables: Record<string, unknown>) => {
    const gid = bookGlobalId(harness.aliceOwner.userId, MANY_BOOK_ID);
    const result = await harness.execute(pageQuery(gid), {
      viewer: harness.aliceViewer,
      variables,
    });
    expect(result.errors).toBeUndefined();
    return (result.data as MessagesData).viewer.library.book.validation.messages;
  };

  beforeEach(async () => {
    // Five messages, inserted out of seq order (mirrors the "sends an
    // explicit seq ORDER BY" fixture above) — enough rows to prove `first`/
    // `after` advance the page and `last`/`before` genuinely paginate
    // backward, not just accept the arguments.
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: MANY_BOOK_ID,
        title: 'Very Broken',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
    await harness.prisma.validation.create({
      data: {
        userId: harness.aliceOwner.userId,
        bookId: MANY_BOOK_ID,
        valid: false,
        threshold: 'ERROR',
        validatedAt: 1,
        messages: {
          create: [4, 1, 3, 0, 2].map((seq) => ({
            seq,
            code: `CODE-${seq}`,
            severity: 'ERROR',
            message: `message ${seq}`,
          })),
        },
      },
    });
  });

  it('orders by seq ascending', async () => {
    const page = await readMessages({ first: 10 });

    expect(page.edges.map((e) => e.node.seq)).toEqual([0, 1, 2, 3, 4]);
  });

  it('paginates forward — page two differs from page one when the cursor is fed back as `after`', async () => {
    const first = await readMessages({ first: 2 });

    expect(first.edges.map((e) => e.node.seq)).toEqual([0, 1]);
    expect(first.pageInfo.hasNextPage).toBe(true);

    const second = await readMessages({ first: 2, after: first.edges[1].cursor });

    // Genuinely distinguishes "after is honored" from "after is ignored": an
    // ignored cursor would hand back page one again.
    expect(second.edges.map((e) => e.node.seq)).toEqual([2, 3]);
  });

  it('accepts a per-edge cursor as `after`, not only pageInfo.endCursor', async () => {
    const all = await readMessages({ first: 10 });

    const after = await readMessages({ first: 10, after: all.edges[0].cursor });

    expect(after.edges.map((e) => e.node.seq)).toEqual([1, 2, 3, 4]);
  });

  // `last`/`before` genuinely work here — `t.relatedConnection` paginates a
  // real Prisma relation and supports backward pagination natively, unlike
  // `Library.entries`/`Library.progress` (see `rejectBackwardPagination`'s
  // doc comment in `pagination.ts`). This must not merely be "accepted
  // without error" — it must return the actual trailing page.
  it('supports `last` alone, returning the trailing page in ascending order', async () => {
    const page = await readMessages({ last: 2 });

    expect(page.edges.map((e) => e.node.seq)).toEqual([3, 4]);
  });

  it('supports `last`/`before` together, walking backward from a cursor', async () => {
    const all = await readMessages({ first: 10 });
    const lastEdgeCursor = all.edges[all.edges.length - 1].cursor; // seq 4

    const page = await readMessages({ last: 2, before: lastEdgeCursor });

    // The two messages immediately before seq 4, in ascending order — proves
    // `before` is honored (not ignored, which would return the unfiltered
    // trailing page again).
    expect(page.edges.map((e) => e.node.seq)).toEqual([2, 3]);
  });

  it('does not leak another user validation messages', async () => {
    // The gid decodes to ALICE's userId — deliberately, since bob reading it
    // through his own `Viewer.library` is exactly the owner-mismatch "not
    // found" arm `library/model.ts`'s doc comment establishes.
    const gid = bookGlobalId(harness.aliceOwner.userId, MANY_BOOK_ID);
    const result = await harness.execute(pageQuery(gid), {
      viewer: harness.bobViewer,
      variables: { first: 10 },
    });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });

  // Query-cost-control task 1. Same mechanism as `Series.books`
  // (`series/model.ts`'s doc comment on its `books` field) — the reject
  // lives in the `query` callback, not a `resolve` override, because
  // `t.relatedConnection` only calls a user `resolve` as a fallback.
  describe('page-size bound', () => {
    it('rejects `first` one above the max page size (500)', async () => {
      const result = await harness.execute(
        pageQuery(bookGlobalId(harness.aliceOwner.userId, MANY_BOOK_ID)),
        {
          viewer: harness.aliceViewer,
          variables: { first: 501 },
        }
      );

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.extensions).toEqual({
        code: 'PAGE_SIZE_EXCEEDED',
        http: { status: 400 },
      });
    });

    it('accepts `first` exactly at the max page size (500)', async () => {
      const page = await readMessages({ first: 500 });

      expect(page.edges).toHaveLength(5);
    });

    it('returns at most the default page size (50) when `first` is omitted', async () => {
      // Five messages already exist (the fixture above) — far below the
      // default of 50. Seed enough more that the assertion actually
      // discriminates a bound from no bound at all.
      await harness.prisma.validationMessage.createMany({
        data: Array.from({ length: 60 }, (_, i) => ({
          userId: harness.aliceOwner.userId,
          bookId: MANY_BOOK_ID,
          seq: i + 10,
          code: `FILLER-${i}`,
          severity: 'ERROR',
          message: `filler ${i}`,
        })),
      });

      const result = await harness.execute(
        `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, MANY_BOOK_ID)}") { validation {
          messages {
            edges { node { seq } }
            pageInfo { hasNextPage }
          }
        } } } } }`,
        { viewer: harness.aliceViewer }
      );

      expect(result.errors).toBeUndefined();
      const messages = (
        result.data as {
          viewer: {
            library: {
              book: {
                validation: { messages: { edges: unknown[]; pageInfo: { hasNextPage: boolean } } };
              };
            };
          };
        }
      ).viewer.library.book.validation.messages;
      expect(messages.edges).toHaveLength(50);
      expect(messages.pageInfo.hasNextPage).toBe(true);
    });
  });
});
