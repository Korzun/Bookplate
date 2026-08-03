import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

const seedProgress = async (userId: string, document: string, timestamp: number) => {
  await harness.prisma.progress.create({
    data: {
      userId,
      document,
      progress: '/x',
      percentage: 0.5,
      device: 'Kobo',
      deviceId: 'dev-1',
      timestamp,
    },
  });
};

beforeEach(async () => {
  harness = await createHarness();
  // Descending timestamps, so the store's `timestamp desc` order is p3, p2, p1.
  await seedProgress(harness.aliceOwner.userId, '1'.repeat(32), 1_700_000_001);
  await seedProgress(harness.aliceOwner.userId, '2'.repeat(32), 1_700_000_002);
  await seedProgress(harness.aliceOwner.userId, '3'.repeat(32), 1_700_000_003);
  await seedProgress(harness.bobOwner.userId, '9'.repeat(32), 1_700_000_009);
});

afterEach(async () => {
  await harness.cleanup();
});

const PAGE = `
  query ($first: Int, $after: String) {
    viewer { library { progress(first: $first, after: $after) {
      edges { cursor node { document } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    } } }
  }
`;

type PageData = {
  viewer: {
    library: {
      progress: {
        edges: { cursor: string; node: { document: string } }[];
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
      };
    };
  };
};

const readPage = async (
  variables: Record<string, unknown>,
  viewer: Harness['aliceViewer'] = harness.aliceViewer
) => {
  const result = await harness.execute(PAGE, { viewer, variables });
  expect(result.errors).toBeUndefined();
  return (result.data as PageData).viewer.library.progress;
};

describe('Library.progress', () => {
  it('returns the whole list newest-first when it fits on one page', async () => {
    const page = await readPage({ first: 10 });

    expect(page.edges.map((e) => e.node.document)).toEqual([
      '3'.repeat(32),
      '2'.repeat(32),
      '1'.repeat(32),
    ]);
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.hasPreviousPage).toBe(false);
  });

  it('paginates with the store cursor — after excludes what was already returned', async () => {
    const first = await readPage({ first: 2 });

    expect(first.edges.map((e) => e.node.document)).toEqual(['3'.repeat(32), '2'.repeat(32)]);
    expect(first.pageInfo.hasNextPage).toBe(true);
    expect(first.pageInfo.endCursor).not.toBeNull();

    const second = await readPage({ first: 2, after: first.pageInfo.endCursor });

    // Genuinely distinguishes "after is honored" from "after is ignored": an
    // ignored cursor would hand back page one again.
    expect(second.edges.map((e) => e.node.document)).toEqual(['1'.repeat(32)]);
    expect(second.pageInfo.hasNextPage).toBe(false);
    expect(second.pageInfo.hasPreviousPage).toBe(true);
  });

  it('accepts a per-edge cursor as `after`, not only pageInfo.endCursor', async () => {
    const all = await readPage({ first: 10 });

    // Resuming after the FIRST edge must yield exactly the entries following
    // it — the per-edge cursors are minted here rather than by the store, so
    // this is the only thing proving they encode the same keyset.
    const after = await readPage({ first: 10, after: all.edges[0].cursor });

    expect(after.edges.map((e) => e.node.document)).toEqual(['2'.repeat(32), '1'.repeat(32)]);
  });

  // Superseded by query-cost-control task 1's "reject, never clamp" ruling
  // (pagination.ts's `rejectOversizePage` doc comment): a silent clamp here
  // used to answer an out-of-range `first` with a truncated page; it now
  // rejects loudly instead, matching `Library.entries`'s own oversize test.
  it('rejects `first` above 100 instead of silently clamping it', async () => {
    const result = await harness.execute(PAGE, {
      viewer: harness.aliceViewer,
      variables: { first: 100_000 },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]?.extensions).toEqual({
      code: 'PAGE_SIZE_EXCEEDED',
      http: { status: 400 },
    });
  });

  it('accepts `first` exactly at 100, the max page size', async () => {
    const page = await readPage({ first: 100 });

    expect(page.edges).toHaveLength(3);
  });

  it('returns at most the default page size (50) when `first` is omitted', async () => {
    // Seed past the default so the assertion actually discriminates: the
    // `beforeEach` fixture above (3 rows) is far below 50 and would pass
    // this test even with no bound at all.
    for (let i = 0; i < 60; i++) {
      const document = `d${String(i).padStart(2, '0')}`.padEnd(32, 'z');
      await seedProgress(harness.aliceOwner.userId, document, 1_600_000_000 + i);
    }
    const page = await readPage({});

    expect(page.edges).toHaveLength(50);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  it('rejects backward pagination loudly rather than returning the leading page', async () => {
    const result = await harness.execute(
      '{ viewer { library { progress(last: 2) { edges { node { document } } } } } }',
      { viewer: harness.aliceViewer }
    );

    expect(result.errors?.[0]?.extensions?.code).toBe('BACKWARD_PAGINATION_UNSUPPORTED');
  });

  /**
   * Reads through `Query.user(id:).library` as the admin. This is the
   * assertion that discriminates "pages the parent Owner's progress" from
   * "pages the viewer's": the config-based admin has a null `userId` and no
   * progress of its own, so a resolver consulting the viewer instead of the
   * parent returns nothing here while every self-read test above still passes.
   */
  it("reads the owner off its parent — an admin pages the target user's progress", async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { progress(first: 10) {
        edges { node { document } }
      } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (
        result.data as {
          user: { library: { progress: { edges: { node: { document: string } }[] } } };
        }
      ).user.library.progress.edges.map((e) => e.node.document)
    ).toEqual(['3'.repeat(32), '2'.repeat(32), '1'.repeat(32)]);
  });

  it("does not page through another user's progress", async () => {
    const bobPage = await readPage({ first: 10 }, harness.bobViewer);

    expect(bobPage.edges.map((e) => e.node.document)).toEqual(['9'.repeat(32)]);
  });
});
