import { decodeGlobalID, encodeGlobalID } from '@pothos/plugin-relay';

import type { Viewer } from '../../context';
import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'f'.repeat(32);

// Computed the same way the resolver decodes it — see validate.test.ts's
// identical `bookGlobalId` helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

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
  it('exposes the reader position under its new name, `position`', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { progress { position } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: { position: string } } } } }).viewer
        .library.book.progress.position
    ).toBe('/body/DocFragment[3]');
  });

  it('rejects the old field name — `progress` no longer exists on the Progress type', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { progress { progress } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.data).toBeUndefined();
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors?.[0]?.message).toMatch(/progress/i);
  });

  it('describes `position` as a KOReader CFI/xpointer string', async () => {
    const result = await harness.execute(
      '{ __type(name: "Progress") { fields { name description } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const fields = (result.data as { __type: { fields: { name: string; description: string }[] } })
      .__type.fields;
    expect(fields.find((f) => f.name === 'position')?.description).toBe(
      'Reader position as a KOReader CFI/xpointer string.'
    );
  });

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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { progress { percentage } } } } }`,
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, '0'.repeat(32))}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { progress: unknown } } } }).viewer.library.book
        .progress ?? null
    ).toBeNull();
  });

  // Admin-traversal-discriminating: the config-based admin has no `userId`
  // of its own (`test-util.ts`'s `adminViewer`, `viewer.userId === null`), so
  // a resolver that read `context.viewer!.userId` instead of the row's own
  // `userId` would encode `null` into the id here, not alice's real id — a
  // self-read (alice reading her own progress) cannot discriminate the two,
  // since her own `context.viewer.userId` and the row's `userId` are the
  // same value. Reads `id` and decodes it rather than the removed `userId`
  // field — the two prove the same thing, since `id` now carries the row's
  // owner.
  it('exposes the owning userId through id — admin traversal proves it reads the row, not the viewer', async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { progress(first: 10) { edges { node { id document } } } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const edges = (
      result.data as {
        user: {
          library: { progress: { edges: { node: { id: string; document: string } }[] } };
        };
      }
    ).user.library.progress.edges;
    expect(edges).toHaveLength(1);
    const { typename, id: local } = decodeGlobalID(edges[0]!.node.id);
    expect(typename).toBe('Progress');
    expect(JSON.parse(local)).toEqual([harness.aliceOwner.userId, BOOK_ID]);
    expect(edges[0]?.node.document).toBe(BOOK_ID);
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.bobOwner.userId, BOOK_ID)}") { progress { percentage } } } } }`,
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
      .map(
        (id, i) =>
          `b${i}: book(id: "${bookGlobalId(harness.aliceOwner.userId, id)}") { progress { percentage } }`
      )
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
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, BOOK_ID)}") { progress { percentage } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  }, 2000);
});

const PROGRESS_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on Library {
        progress(first: 10) {
          edges { node { id document percentage } }
        }
      }
    }
  }
`;

describe('Progress.id', () => {
  // Tenant isolation is the whole point: `document` is a KOReader content
  // hash, so two users who own the same book have the SAME document value.
  // A single-user fixture would pass even if `id` were just the document.
  it('differs between two users who share a document hash', async () => {
    const shared = 'shared-document-hash';
    await seedProgress(harness.aliceOwner.userId, shared);
    await seedProgress(harness.bobOwner.userId, shared);

    const aliceId = await firstProgressId(harness.aliceViewer, harness.aliceOwner, shared);
    const bobId = await firstProgressId(harness.bobViewer, harness.bobOwner, shared);

    expect(aliceId).not.toEqual(bobId);
  });

  it('decodes to the owning user and the document', async () => {
    const shared = 'shared-document-hash';
    await seedProgress(harness.aliceOwner.userId, shared);

    const id = await firstProgressId(harness.aliceViewer, harness.aliceOwner, shared);
    const { typename, id: local } = decodeGlobalID(id);

    expect(typename).toBe('Progress');
    expect(JSON.parse(local)).toEqual([harness.aliceOwner.userId, shared]);
  });

  it('no longer exposes a raw userId field', async () => {
    const result = await harness.execute(
      `query($id: ID!) { node(id: $id) { ... on Library { progress(first: 1) { edges { node { userId } } } } } }`,
      { viewer: harness.aliceViewer, variables: { id: libraryIdOf(harness.aliceOwner) } }
    );

    // A removed field is a VALIDATION error, so `data` is absent entirely.
    expect(result.errors?.[0]?.message).toMatch(/Cannot query field "userId"/);
  });
});

const seedProgress = (userId: string, document: string): Promise<unknown> =>
  harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress: 'EPUB_CFI(/6/4!/4/2:0)',
      percentage: 0.5,
      device: 'Web',
      deviceId: 'dev-1',
      timestamp: 1_700_000_000,
    },
  });

/** The harness exposes no library id; a Library's global ID is its owner's user id. */
const libraryIdOf = (owner: { userId: string }) => encodeGlobalID('Library', owner.userId);

// Selects by `document` rather than blindly indexing `edges[0]` — this
// file's own top-level `beforeEach` already seeds an unrelated progress row
// for alice (`BOOK_ID`), so alice's library has more than one row by the time
// these tests run.
const firstProgressId = async (
  viewer: Viewer,
  owner: { userId: string },
  document: string
): Promise<string> => {
  const result = await harness.execute(PROGRESS_QUERY, {
    viewer,
    variables: { id: libraryIdOf(owner) },
  });
  const node = result.data?.node as {
    progress: { edges: { node: { id: string; document: string } }[] };
  };
  const edge = node.progress.edges.find((e) => e.node.document === document);
  if (edge === undefined) throw new Error(`no progress row found for document ${document}`);
  return edge.node.id;
};
