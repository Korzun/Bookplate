import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

const ids = ['a', 'b', 'c'].map((ch) => ch.repeat(32));

const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

beforeEach(async () => {
  harness = await createHarness();
  const userId = harness.aliceOwner.userId;
  for (const [i, id] of ids.entries()) {
    await harness.prisma.book.create({
      data: { userId, id, title: `Book ${'ABC'[i]}`, size: 1, mtime: 1, addedAt: 1 },
    });
  }
  await harness.prisma.collection.create({
    data: { id: 'col-1', userId, name: 'Favourites', sortKey: 'favourites' },
  });
  await harness.prisma.collection.create({
    data: { id: 'col-2', userId, name: 'Archive', sortKey: 'archive' },
  });
  // Insertion order differs from expected order: null-position book A first,
  // then C at 2, B at 1. Expected: B (1), C (2), A (null, last).
  await harness.prisma.bookCollection.createMany({
    data: [
      { userId, bookId: ids[0]!, collectionId: 'col-1', position: null },
      { userId, bookId: ids[2]!, collectionId: 'col-1', position: 2 },
      { userId, bookId: ids[1]!, collectionId: 'col-1', position: 1 },
      { userId, bookId: ids[0]!, collectionId: 'col-2', position: 5 },
    ],
  });
});

afterEach(async () => {
  await harness.cleanup();
});

interface ByName {
  viewer: {
    library: {
      collectionByName: {
        id: string;
        name: string;
        bookCount: number;
        books: { edges: { node: { position: number | null; book: { title: string } } }[] };
      } | null;
    };
  };
}

const byName = (name: string): string =>
  `{ viewer { library { collectionByName(name: "${name}") { id name bookCount
    books { edges { node { position book { title } } } } } } } }`;

describe('Collection', () => {
  it('exposes name, bookCount and books ordered by position, nulls last', async () => {
    const result = await harness.execute(byName('Favourites'), { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    const col = (result.data as unknown as ByName).viewer.library.collectionByName!;
    expect(col.name).toBe('Favourites');
    expect(col.bookCount).toBe(3);
    expect(col.books.edges.map((e) => [e.node.book.title, e.node.position])).toEqual([
      ['Book B', 1],
      ['Book C', 2],
      ['Book A', null],
    ]);
  });

  it('breaks position ties by book title', async () => {
    await harness.prisma.bookCollection.updateMany({
      where: { collectionId: 'col-1' },
      data: { position: null },
    });
    const result = await harness.execute(byName('Favourites'), { viewer: harness.aliceViewer });

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as unknown as ByName).viewer.library.collectionByName!.books.edges.map(
        (e) => e.node.book.title
      )
    ).toEqual(['Book A', 'Book B', 'Book C']);
  });

  it('paginates with a cursor', async () => {
    const result = await harness.execute(
      `{ viewer { library { collectionByName(name: "Favourites") {
        books(first: 2) { pageInfo { hasNextPage endCursor } edges { node { book { title } } } } } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(result.errors).toBeUndefined();
    const page = (
      result.data as {
        viewer: {
          library: {
            collectionByName: {
              books: { pageInfo: { hasNextPage: boolean; endCursor: string } };
            };
          };
        };
      }
    ).viewer.library.collectionByName.books;
    expect(page.pageInfo.hasNextPage).toBe(true);

    const next = await harness.execute(
      `{ viewer { library { collectionByName(name: "Favourites") {
        books(first: 2, after: "${page.pageInfo.endCursor}") { edges { node { book { title } } } } } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(next.errors).toBeUndefined();
    expect(JSON.stringify(next.data)).toContain('Book A');
    expect(JSON.stringify(next.data)).not.toContain('Book B');
  });

  it('rejects an oversize page', async () => {
    const result = await harness.execute(
      '{ viewer { library { collectionByName(name: "Favourites") { books(first: 101) { edges { cursor } } } } } }',
      { viewer: harness.aliceViewer }
    );
    expect(result.errors).toBeDefined();
  });

  it('lists a book’s collections sorted by name, with position', async () => {
    const gid = bookGlobalId(harness.aliceOwner.userId, ids[0]!);
    const result = await harness.execute(
      `{ viewer { library { book(id: "${gid}") { collections { position collection { name } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const rows = (
      result.data as {
        viewer: {
          library: {
            book: { collections: { position: number | null; collection: { name: string } }[] };
          };
        };
      }
    ).viewer.library.book.collections;
    expect(rows.map((r) => [r.collection.name, r.position])).toEqual([
      ['Archive', 5],
      ['Favourites', null],
    ]);
  });

  it('hides another user’s collection from collectionByName and node(id:)', async () => {
    const byNameResult = await harness.execute(byName('Favourites'), {
      viewer: harness.bobViewer,
    });
    expect(byNameResult.errors).toBeUndefined();
    expect((byNameResult.data as unknown as ByName).viewer.library.collectionByName).toBeNull();

    const own = await harness.execute(byName('Favourites'), { viewer: harness.aliceViewer });
    const id = (own.data as unknown as ByName).viewer.library.collectionByName!.id;
    const asAlice = await harness.execute(`{ node(id: "${id}") { ... on Collection { name } } }`, {
      viewer: harness.aliceViewer,
    });
    expect((asAlice.data as { node: { name: string } }).node.name).toBe('Favourites');

    const asBob = await harness.execute(`{ node(id: "${id}") { ... on Collection { name } } }`, {
      viewer: harness.bobViewer,
    });
    expect(asBob.errors).toBeUndefined();
    expect((asBob.data as { node: unknown }).node).toBeNull();
  });

  it('returns null for an unknown or deleted name', async () => {
    const result = await harness.execute(byName('Nope'), { viewer: harness.aliceViewer });
    expect(result.errors).toBeUndefined();
    expect((result.data as unknown as ByName).viewer.library.collectionByName).toBeNull();

    await harness.prisma.bookCollection.deleteMany({ where: { collectionId: 'col-2' } });
    await harness.prisma.collection.delete({ where: { id: 'col-2' } });
    const gone = await harness.execute(byName('Archive'), { viewer: harness.aliceViewer });
    expect((gone.data as unknown as ByName).viewer.library.collectionByName).toBeNull();
  });
});
