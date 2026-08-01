import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

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

const BOOK = `{
  viewer { library { book(id: "${'a'.repeat(32)}") {
    id bookId title author size pageCount
    subjects identifiers { scheme value }
    chapterSpineMap chapterNames
    hasCover coverUrl downloadUrl thumbnailUrl(width: 200)
    mtime addedAt
  } } }
}`;

describe('Book', () => {
  it('parses the JSON-string columns into real fields', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;
    expect(book.subjects).toEqual(['Fantasy', 'Epic']);
    expect(book.identifiers).toEqual([{ scheme: 'ISBN', value: '9780441013593' }]);
    expect(book.chapterSpineMap).toEqual([0, 3, 7]);
    expect(book.chapterNames).toEqual(['One', 'Two', 'Three']);
  });

  // The raw content hash, alongside the Relay global id. Three sibling fields
  // carry this same value (Progress.document, LinkedDocument.oldId/newId) and
  // Library.book(id:) takes it as an argument, so without it a client holding
  // a Book cannot join to any of them.
  it('exposes the raw content-hash id distinctly from the global id', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;

    expect(book.bookId).toBe('a'.repeat(32));
    // Must not be the global id — that is base64 over JSON.stringify([userId,
    // id]) and cannot be turned back into this hash client-side.
    expect(book.id).not.toBe(book.bookId);
    // And it must be the value Library.book(id:) accepts, round-tripped.
    const roundTrip = await harness.execute(
      `{ viewer { library { book(id: "${'a'.repeat(32)}") { title } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(
      (roundTrip.data as { viewer: { library: { book: { title: string } | null } } }).viewer.library
        .book?.title
    ).toBe('Dune');
  });

  it('derives hasCover from the stored mime type and exposes REST URLs', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });
    const book = (result.data as { viewer: { library: { book: Record<string, unknown> } } }).viewer
      .library.book;

    expect(book.hasCover).toBe(true);
    expect(book.coverUrl).toContain('a'.repeat(32));
    expect(book.downloadUrl).toContain('a'.repeat(32));
    expect(book.thumbnailUrl).toContain('200');
  });

  it('converts epoch-millisecond columns to DateTime', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.aliceViewer });
    const book = (result.data as { viewer: { library: { book: { mtime: string } } } }).viewer
      .library.book;

    expect(book.mtime).toBe('2023-11-14T22:13:20.000Z');
  });

  it('returns null for a book in another user library', async () => {
    const result = await harness.execute(BOOK, { viewer: harness.bobViewer });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: unknown } } }).viewer.library.book ?? null
    ).toBeNull();
  });
});
