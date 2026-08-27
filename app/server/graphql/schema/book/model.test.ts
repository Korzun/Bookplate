import { decodeGlobalID, encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

// Computed the same way the resolver decodes it — see validate.test.ts's
// identical `bookGlobalId` helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: 'a'.repeat(32),
      title: 'Dune',
      author: 'Frank Herbert',
      size: 1234,
      mtime: 1_700_000_000_000,
      addedAt: 1_700_000_000_000,
      pageCount: 412,
      chapterCount: 3,
      identifiers: '[{"scheme":"ISBN","value":"9780441013593"}]',
      subjects: '["Fantasy","Epic"]',
      chapterSpineMap: '[0,3,7]',
      chapterNames: '["One","Two","Three"]',
      coverMime: 'image/jpeg',
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

const BOOK_ID = 'a'.repeat(32);

// The selection set both `bookQuery` (self-read, via `viewer.library`) and
// the admin-traversal URL test (via `user(id:).library`) share.
const BOOK_FIELDS = `
  id title author size pageCount
  subjects identifiers { scheme value }
  chapterSpineMap chapterNames
  hasCover coverUrl downloadUrl thumbnailUrl(width: 200)
  mtime addedAt
`;

const bookQuery = (gid: string): string => `{
  viewer { library { book(id: "${gid}") { ${BOOK_FIELDS} } } }
}`;

describe('Book', () => {
  it('parses the JSON-string columns into real fields', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, BOOK_ID)),
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;
    expect(book.subjects).toEqual(['Fantasy', 'Epic']);
    expect(book.identifiers).toEqual([{ scheme: 'ISBN', value: '9780441013593' }]);
    expect(book.chapterSpineMap).toEqual([0, 3, 7]);
    expect(book.chapterNames).toEqual(['One', 'Two', 'Three']);
  });

  it('derives hasCover from the stored mime type and exposes REST URLs', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, BOOK_ID)),
      { viewer: harness.aliceViewer }
    );
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;

    expect(book.hasCover).toBe(true);
    expect(book.coverUrl).toContain(BOOK_ID);
    expect(book.downloadUrl).toContain(BOOK_ID);
    expect(book.thumbnailUrl).toContain('200');
  });

  it('converts epoch-millisecond columns to DateTime', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, BOOK_ID)),
      { viewer: harness.aliceViewer }
    );
    const book = (result.data as { viewer: { library: { book: { mtime: string } } } }).viewer
      .library.book;

    expect(book.mtime).toBe('2023-11-14T22:13:20.000Z');
  });

  // The gid decodes to alice's userId, but this Library.book field resolves
  // under BOB's own `Viewer.library` — an owner-mismatched gid, the "not
  // found" convention library/model.ts's doc comment establishes, not a
  // permissions error.
  //
  // CORRECTED (task-2 review, I-1): this test does NOT discriminate the
  // owner-mismatch guard (`library/model.ts`'s `parsed[0] !== owner.userId`).
  // Bob owns no row under `BOOK_ID` at all, so dropping the guard only
  // changes "denied before the query runs" into "queried and not found" —
  // both null either way. The guard is only observable when a row ALSO
  // exists under the parent owner's own userId for that same raw id; see
  // the discriminating test below, which the review names directly.
  it('returns null for a book in another user library', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, BOOK_ID)),
      { viewer: harness.bobViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });

  // The actual discriminator for the owner-mismatch guard (task-2 review,
  // I-1): book ids are content hashes, so two users routinely hold a row
  // under the identical id. Alice already has one under `BOOK_ID`
  // (`beforeEach`); this seeds bob under the SAME id too, then asks for
  // ALICE's library with BOB's gid for that shared hash. A resolver that
  // dropped `parsed[0] !== owner.userId` would fall back to `{userId:
  // owner.userId (alice), id: parsed[1] (BOOK_ID)}` — a row that genuinely
  // exists — and silently resolve ALICE's own book for a gid that names
  // bob's copy, instead of null. Run via admin traversal so it also
  // discriminates "reads the parent Library's own owner" from any
  // viewer-derived substitution.
  it("returns null for another user's gid naming the same content hash a row exists under for the queried owner", async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: BOOK_ID,
        title: "Bob's Copy",
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { book(id: "${bookGlobalId(harness.bobOwner.userId, BOOK_ID)}") { id } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { user: { library: { book: unknown } } }).user.library.book ?? null
    ).toBeNull();
  });

  // Task 10b: `documentId` is a display-only carrier of the raw content-hash
  // `Book.id` column — added because the lineage modal's top row has nothing
  // to derive a current book's own id from when its lineage list is empty.
  // Distinct from the Relay `id` (which encodes `[userId, id]`, not the raw
  // hash alone) — the third assertion confirms the global id still embeds
  // the same raw hash `documentId` exposes, not an unrelated value.
  it('exposes the raw content hash as documentId, distinct from the Relay id', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);
    const result = await harness.execute(
      `{ viewer { library { book(id: "${gid}") { id documentId } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const book = (
      result.data as { viewer: { library: { book: { id: string; documentId: string } } } }
    ).viewer.library.book;
    expect(book.documentId).toBe(BOOK_ID);
    expect(book.id).not.toBe(book.documentId);
    expect(decodeGlobalID(book.id).id).toContain(book.documentId);
  });

  it('resolves null for a malformed local id', async () => {
    const result = await harness.execute(bookQuery(encodeGlobalID('Book', 'not-json')), {
      viewer: harness.aliceViewer,
    });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });
});

/**
 * A book's id is its content hash, so re-importing an edited EPUB MINTS A NEW
 * ONE and the old id names nothing — `reimportBook` writes the old → new
 * mapping into `book_id_history` as it goes (`services/book-store.ts`). Until
 * this resolver consulted that table, every superseded id was a dead end that
 * a reload could not clear: a bookmark, the back button, a shared link or a
 * second tab all rendered "Book not found." for a book that plainly still
 * exists. `bookStore.resolveBookId` already did this mapping for KOReader
 * sync (`routes/kosync.ts`); these pin it for the GraphQL read.
 *
 * The lookup is a FALLBACK, not a prefix: the direct `findUnique` runs first
 * and short-circuits, so a live id costs exactly what it always did and only
 * an id that resolves to nothing pays for the history lookup.
 */
describe('Library.book(id:) — superseded ids', () => {
  const OLD_ID = 'b'.repeat(32);

  it('resolves a superseded id to the row that supersedes it', async () => {
    await harness.prisma.bookIdHistory.create({
      data: { userId: harness.aliceOwner.userId, oldId: OLD_ID, currentId: BOOK_ID },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${bookGlobalId(harness.aliceOwner.userId, OLD_ID)}") { id title } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const book = (result.data as { viewer: { library: { book: { id: string; title: string } } } })
      .viewer.library.book;
    expect(book.title).toBe('Dune');
    // The CURRENT id comes back, not the superseded one that was asked for —
    // so a client that keys its cache on the response settles on the live id
    // rather than re-pinning the dead one.
    expect(book.id).toBe(bookGlobalId(harness.aliceOwner.userId, BOOK_ID));
  });

  // The unchanged half: `resolveBookId` returns its INPUT when there is no
  // mapping, so an id that never existed must still resolve null rather than
  // falling through to some other row.
  it('still resolves null for an id with no history entry', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, OLD_ID)),
      {
        viewer: harness.aliceViewer,
      }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });

  // The tenant boundary on the NEW lookup. `book_id_history` is keyed
  // `[userId, oldId]`, and this passes the owning Library's `userId` — not
  // the viewer's, and not an unscoped `oldId` match. Bob holds the only
  // mapping for `OLD_ID`; alice asking under her own gid must not reach it.
  it("does not resolve through another user's history entry", async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.bobOwner.userId,
        id: BOOK_ID,
        title: "Bob's Copy",
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });
    await harness.prisma.bookIdHistory.create({
      data: { userId: harness.bobOwner.userId, oldId: OLD_ID, currentId: BOOK_ID },
    });

    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, OLD_ID)),
      {
        viewer: harness.aliceViewer,
      }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });
});

describe('Book URL fields', () => {
  // Self-read: no `?user=` param — an admin-shaped URL leaking onto a
  // self-read would be dead weight at best, and REST 403s a non-admin
  // session that sends `?user=` at all (routes/ui.ts's `resolveOwner`).
  // Seen-to-fail against the pre-task-2 bare-path URL: this assertion (and
  // the admin one below) would fail against `coverUrl: () =>
  // \`/api/books/${book.id}/cover\`` with no suffix at all.
  it('self-read exposes no ?user= param, only the v= cache token', async () => {
    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, BOOK_ID)),
      { viewer: harness.aliceViewer }
    );
    const book = (result.data as { viewer: { library: { book: Record<string, string> } } }).viewer
      .library.book;

    expect(book.coverUrl).not.toContain('user=');
    expect(book.coverUrl).toContain('v=1700000000000');
    expect(book.downloadUrl).not.toContain('user=');
    expect(book.downloadUrl).toContain('v=1700000000000');
    expect(book.thumbnailUrl).not.toContain('user=');
    expect(book.thumbnailUrl).toMatch(/^\/api\/books\/.+\/cover\?width=200&v=1700000000000$/);
  });

  // Admin traversal: this is the assertion that discriminates "resolves the
  // owner off the book row" from "the pre-task-2 bare path" — REST's own
  // `resolveOwner` 400s an admin session hitting a book route without
  // `?user=<username>`, so a URL missing this param was never fetchable for
  // an admin viewer at all (the bug task 2 fixes).
  it('admin traversal exposes ?user=<owner username>&v=<mtime>', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { book(id: "${gid}") { ${BOOK_FIELDS} } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );

    expect(result.errors).toBeUndefined();
    const book = (result.data as { user: { library: { book: Record<string, string> } } }).user
      .library.book;

    expect(book.coverUrl).toContain('user=alice');
    expect(book.coverUrl).toContain('v=1700000000000');
    expect(book.downloadUrl).toContain('user=alice');
    expect(book.downloadUrl).toContain('v=1700000000000');
    expect(book.thumbnailUrl).toMatch(
      /^\/api\/books\/.+\/cover\?width=200&user=alice&v=1700000000000$/
    );
  });

  // Task-2 review, I-3: `mtime` is a Prisma `Float` holding `stat.mtimeMs`
  // (services/book-store.ts), so a real book's mtime is routinely fractional
  // (e.g. `1785702915092.761`). The pre-fix `v=${book.mtime}` emitted that
  // fraction verbatim, diverging byte-for-byte from the REST client's own
  // cache-busting token (`app/client/src/lib/cover-url.ts`'s `versionToken`,
  // which floors) — two different `?v=` strings, and so two immutable-cache
  // entries, for the identical cover. Every other fixture in this file uses
  // an integer literal mtime and so could not have caught this.
  it('floors a fractional mtime in the v= cache token', async () => {
    const fractionalId = 'b'.repeat(32);
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: fractionalId,
        title: 'Fractional Mtime',
        size: 1,
        mtime: 1_700_000_000_123.789,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      bookQuery(bookGlobalId(harness.aliceOwner.userId, fractionalId)),
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const book = (result.data as { viewer: { library: { book: Record<string, string> } } }).viewer
      .library.book;
    expect(book.coverUrl).toContain('v=1700000000123');
    expect(book.coverUrl).not.toContain('.');
  });
});
