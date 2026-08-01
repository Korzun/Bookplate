import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'f'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Read Me',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.progress.create({
    data: {
      userId: harness.aliceOwner.userId,
      document: BOOK_ID,
      progress: '/body/DocFragment[3]',
      percentage: 0.42,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Progress', () => {
  it('lists the library progress records', async () => {
    const result = await harness.execute(
      '{ viewer { library { progress(first: 10) { edges { node { document percentage device } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as { viewer: { library: { progress: { edges: { node: unknown }[] } } } }
      ).viewer.library.progress.edges.map((e) => e.node)
    ).toEqual([{ document: BOOK_ID, percentage: 0.42, device: 'Kobo' }]);
  });

  it('resolves a book progress as a field, replacing the client-side join', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: { percentage: number } } } } })
        .viewer.library.book.progress.percentage
    ).toBe(0.42);
  });

  it('is null for a book with no progress', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: '0'.repeat(32),
        title: 'Unread',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'0'.repeat(32)}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: unknown } } } }).viewer.library.book
        .progress ?? null
    ).toBeNull();
  });

  it('does not leak another user progress', async () => {
    const result = await harness.execute(
      '{ viewer { library { progress(first: 10) { edges { node { document } } } } } }',
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { progress: { edges: unknown[] } } } }).viewer.library
        .progress.edges
    ).toEqual([]);
  });

  // Book ids are content hashes (partial MD5), so two users routinely hold a
  // book with the identical id for the identical file — see NO_MATCH_USER_ID's
  // doc comment in node-scope.ts. `Book.progress` must key off the *book's*
  // userId, not just the document string, or bob would see alice's progress
  // for a book they both happen to own under the same id.
  it('does not leak another user progress for a book sharing the same id', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: BOOK_ID,
        title: 'Read Me',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { progress { percentage } } } } }`,
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: unknown } } } }).viewer.library.book
        .progress ?? null
    ).toBeNull();
  });

  // `Book.progress` used to be a plain `prisma.progress.findUnique` per book,
  // which is a textbook N+1 across a page of books. It now goes through
  // `context.loadProgress`, a request-scoped batching loader (see
  // `progress-loader.ts`) — this asserts the batching actually happens rather
  // than merely trusting the loader exists.
  it('batches Book.progress across a page of books into a single query', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = i.toString().padStart(32, '0');
      ids.push(id);
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id,
          title: `Book ${i}`,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
      await harness.prisma.progress.create({
        data: {
          userId: harness.aliceOwner.userId,
          document: id,
          progress: '/x',
          percentage: 0.1 * (i % 10),
          device: 'Kobo',
          deviceId: 'dev-1',
          timestamp: 1_700_000_000 + i,
        },
      });
    }

    const findUniqueSpy = vi.spyOn(harness.prisma.progress, 'findUnique');
    const findManySpy = vi.spyOn(harness.prisma.progress, 'findMany');

    const fields = ids
      .map((id, i) => `b${i}: book(id: "${id}") { progress { percentage } }`)
      .join(' ');
    const result = await harness.execute(`{ viewer { library { ${fields} } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(findManySpy).toHaveBeenCalledTimes(1);
  });

  // A prior version of `createProgressLoader` captured only `resolve`, never
  // `reject`, when it took over settling each batched caller's promise. A
  // rejected `findMany` (e.g. a transient DB error) then left every in-flight
  // `Book.progress` lookup in that batch permanently unsettled — the request
  // would hang forever instead of surfacing a GraphQL error, since nothing
  // else was watching that promise. This must resolve well inside the test's
  // own timeout, not merely "eventually" — a regression here should fail
  // fast, not stall the suite.
  it('surfaces a GraphQL error instead of hanging when the progress query fails', async () => {
    vi.spyOn(harness.prisma.progress, 'findMany').mockRejectedValue(new Error('db unavailable'));

    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  }, 2000);
});
