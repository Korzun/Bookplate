import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const LIST = `
  query List($first: Int!, $after: String) {
    viewer {
      user {
        bookRequests(first: $first, after: $after) {
          edges { cursor node { id title status } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const ADMIN_LIST = `
  query AdminList($userId: ID!) {
    user(id: $userId) {
      bookRequests(first: 10) { edges { node { title } } }
    }
  }
`;

/** Seeds `count` requests with strictly increasing `createdAt`, newest last. */
const seed = async (userId: string, count: number): Promise<void> => {
  for (let n = 0; n < count; n++) {
    await harness.prisma.bookRequest.create({
      data: {
        userId,
        id: `req-${n}`,
        title: `Book ${n}`,
        author: 'Author',
        dedupeKey: `book ${n}\0author`,
        createdAt: 1_000 + n,
      },
    });
  }
};

describe('User.bookRequests', () => {
  it('lists the viewer own requests, newest first', async () => {
    await seed(harness.aliceOwner.userId, 3);

    const result = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 10 },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(data.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 2',
      'Book 1',
      'Book 0',
    ]);
  });

  it('is null for the config admin, which has no User row', async () => {
    const result = await harness.execute(LIST, {
      viewer: harness.adminViewer,
      variables: { first: 10 },
    });

    expect(result.errors).toBeUndefined();
    expect((result.data as { viewer: { user: unknown } }).viewer.user).toBeNull();
  });

  it('lets an admin read a target user requests, not their own', async () => {
    await seed(harness.aliceOwner.userId, 1);

    const result = await harness.execute(ADMIN_LIST, {
      viewer: harness.adminViewer,
      variables: { userId: harness.aliceGlobalId },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      user: { bookRequests: { edges: { node: { title: string } }[] } };
    };
    expect(data.user.bookRequests.edges.map((e) => e.node.title)).toEqual(['Book 0']);
  });

  it('rejects a page larger than maxSize rather than clamping it', async () => {
    const result = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 101 },
    });
    expect(result.errors?.[0]?.message).toMatch(/User\.bookRequests/);
  });

  /**
   * THE REASON THIS FIELD USES A KEYSET INSTEAD OF THE PLUGIN CURSOR SEEK.
   * Prisma implements `cursor` by seeking to a row, so a deleted cursor row
   * yields an EMPTY page with `hasNextPage: false` and no error. Deleting a
   * request is a first-class action here, so this is the normal case.
   */
  it('keeps paginating after the cursor row is deleted', async () => {
    await seed(harness.aliceOwner.userId, 4);

    const page1 = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2 },
    });
    const p1 = page1.data as {
      viewer: {
        user: {
          bookRequests: {
            edges: { cursor: string; node: { title: string } }[];
            pageInfo: { endCursor: string };
          };
        };
      };
    };
    expect(p1.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 3',
      'Book 2',
    ]);
    const cursor = p1.viewer.user.bookRequests.pageInfo.endCursor;

    // Delete the exact row that cursor names.
    await harness.prisma.bookRequest.delete({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: 'req-2' } },
    });

    const page2 = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2, after: cursor },
    });
    const p2 = page2.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(p2.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual([
      'Book 1',
      'Book 0',
    ]);
  });

  it('paginates backward', async () => {
    await seed(harness.aliceOwner.userId, 4);

    const forward = await harness.execute(LIST, {
      viewer: harness.aliceViewer,
      variables: { first: 2 },
    });
    const cursor = (
      forward.data as {
        viewer: { user: { bookRequests: { pageInfo: { endCursor: string } } } };
      }
    ).viewer.user.bookRequests.pageInfo.endCursor;

    const backward = await harness.execute(
      `query Back($last: Int!, $before: String) {
         viewer { user { bookRequests(last: $last, before: $before) {
           edges { node { title } } } } }
       }`,
      { viewer: harness.aliceViewer, variables: { last: 1, before: cursor } }
    );

    const data = backward.data as {
      viewer: { user: { bookRequests: { edges: { node: { title: string } }[] } } };
    };
    expect(data.viewer.user.bookRequests.edges.map((e) => e.node.title)).toEqual(['Book 3']);
  });
});

describe('User.pendingBookRequestCount', () => {
  it('counts only pending requests', async () => {
    await seed(harness.aliceOwner.userId, 3);
    await harness.prisma.bookRequest.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: 'req-0' } },
      data: { status: 'fulfilled' },
    });

    const result = await harness.execute('{ viewer { user { pendingBookRequestCount } } }', {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      viewer: { user: { pendingBookRequestCount: number } };
    };
    expect(data.viewer.user.pendingBookRequestCount).toBe(2);
  });

  it('is zero for a reader with no requests', async () => {
    const result = await harness.execute('{ viewer { user { pendingBookRequestCount } } }', {
      viewer: harness.aliceViewer,
    });
    const data = result.data as {
      viewer: { user: { pendingBookRequestCount: number } };
    };
    expect(data.viewer.user.pendingBookRequestCount).toBe(0);
  });
});
