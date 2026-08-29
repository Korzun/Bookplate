import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

// Computed the same way the resolver decodes it — see validate.test.ts's
// identical `bookGlobalId` helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));
// Book ids are content hashes, so two users legitimately hold the SAME id for
// the same file (see NO_MATCH_USER_ID's doc comment in node-scope.ts). Using
// one shared id here is what makes the cross-tenant assertion below able to
// tell "counted for this book's owner" from "counted for this book id".
const SHARED_ID = 'e'.repeat(32);

beforeEach(async () => {
  harness = await createHarness();
  for (const owner of [harness.aliceOwner, harness.bobOwner]) {
    await harness.prisma.book.create({
      data: {
        userId: owner.userId,
        id: SHARED_ID,
        title: 'Shared Hash',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
  }
  // Two cached editions of Alice's copy, none of Bob's.
  for (const deviceId of ['dev-1', 'dev-2']) {
    await harness.prisma.deviceEdition.create({
      data: {
        userId: harness.aliceOwner.userId,
        originalBookId: SHARED_ID,
        deviceId,
        editionId: `ed-${deviceId}`,
        settingsHash: 'h',
      },
    });
  }
  // A third edition of a DIFFERENT book of Alice's, so a resolver that counted
  // every edition the owner has (dropping originalBookId) would report 3.
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: 'f'.repeat(32),
      title: 'Other',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.deviceEdition.create({
    data: {
      userId: harness.aliceOwner.userId,
      originalBookId: 'f'.repeat(32),
      deviceId: 'dev-1',
      editionId: 'ed-other',
      settingsHash: 'h',
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

// `viewer.userId!`: every caller here is alice or bob, both real users with a
// non-null userId — never the config-admin, which has its own `readAsAdmin`.
const countFor = async (viewer: Harness['aliceViewer'], id = SHARED_ID) => {
  const gid = bookGlobalId(viewer.userId!, id);
  const result = await harness.execute(
    `{ viewer { library { book(id: "${gid}") { deviceEditionCount } } } }`,
    { viewer }
  );
  expect(result.errors).toBeUndefined();
  return (result.data as { viewer: { library: { book: { deviceEditionCount: number } } } }).viewer
    .library.book.deviceEditionCount;
};

describe('Book.deviceEditionCount', () => {
  it('counts the cached editions of this book for its owner', async () => {
    expect(await countFor(harness.aliceViewer)).toBe(2);
  });

  it('counts only this book, not every edition the owner has', async () => {
    expect(await countFor(harness.aliceViewer, 'f'.repeat(32))).toBe(1);
  });

  it("does not count another user's editions for a book sharing the same id", async () => {
    // Bob owns a book with the identical id and no editions of his own. A
    // resolver keying on the book id alone — or on anything other than the
    // parent row's own `userId` — would hand him Alice's 2.
    expect(await countFor(harness.bobViewer)).toBe(0);
  });

  // Pins the batching, not merely the numbers: `Book` is reachable from
  // `Library.entries` (up to 100 per page — `CONNECTION_LIMITS`), and this
  // field used to issue one `prisma.deviceEdition.count()` per book with no
  // loader mitigating it, unlike `progress`/`pendingFix`. Mirrors
  // `validation/model.test.ts`'s identical "one groupBy" assertion.
  //
  // Asserts BOTH that the aggregate is one call AND that no per-book `count`
  // survives: a regression that reintroduced `countForBook` beside the loader
  // would still satisfy a groupBy-only assertion.
  it('issues one groupBy for a page of books, not one count each', async () => {
    const ids = ['1', '2', '3', '4'].map((n) => n.repeat(32));
    for (const id of ids) {
      await harness.prisma.book.create({
        data: {
          userId: harness.aliceOwner.userId,
          id,
          title: `Batch ${id[0]}`,
          size: 1,
          mtime: 1,
          addedAt: 1,
        },
      });
      await harness.prisma.deviceEdition.create({
        data: {
          userId: harness.aliceOwner.userId,
          originalBookId: id,
          deviceId: 'dev-1',
          editionId: `ed-${id[0]}`,
          settingsHash: 'h',
        },
      });
    }

    const groupBySpy = vi.spyOn(harness.prisma.deviceEdition, 'groupBy');
    const countSpy = vi.spyOn(harness.prisma.deviceEdition, 'count');

    const fields = ids
      .map(
        (id, i) =>
          `b${i}: book(id: "${bookGlobalId(harness.aliceOwner.userId, id)}") { deviceEditionCount }`
      )
      .join(' ');
    const result = await harness.execute(`{ viewer { library { ${fields} } } }`, {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as Record<
      string,
      { library: Record<string, { deviceEditionCount: number }> }
    >;
    expect(ids.map((_, i) => data.viewer.library[`b${i}`].deviceEditionCount)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(groupBySpy).toHaveBeenCalledTimes(1);
    expect(countSpy).not.toHaveBeenCalled();
  });

  // A book with no editions must resolve 0, not null — the field is `Int!`, and
  // a book with zero rows is simply absent from the `groupBy` result, so the
  // loader has to supply the zero rather than pass `undefined` through.
  it('resolves 0 for a book with no editions rather than failing the field', async () => {
    const id = '9'.repeat(32);
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id,
        title: 'No editions',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
    expect(await countFor(harness.aliceViewer, id)).toBe(0);
  });

  it("reports the owner's count when an admin reads through User.library", async () => {
    // The admin has no userId at all, so a resolver reading the count off the
    // *viewer* rather than off the book row would report 0 here.
    const gid = bookGlobalId(harness.aliceOwner.userId, SHARED_ID);
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { book(id: "${gid}") { deviceEditionCount } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { user: { library: { book: { deviceEditionCount: number } } } }).user.library
        .book.deviceEditionCount
    ).toBe(2);
  });
});
