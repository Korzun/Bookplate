import { encodeGlobalID } from '@pothos/plugin-relay';

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
  // permissions error. Also the seen-to-fail-worthy discriminator for
  // task 2's `Library.book` arg change: a resolver that dropped the owner
  // check (or substituted the viewer's own userId) would resolve this to
  // alice's row instead of null.
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
});
