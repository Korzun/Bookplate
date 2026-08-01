import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: 'a'.repeat(32),
      title: 'Alice One',
      author: 'Ursula K. Le Guin',
      subjects: JSON.stringify(['Fantasy', 'Fiction']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: 'c'.repeat(32),
      title: 'Alice Two',
      author: 'Ann Leckie',
      subjects: JSON.stringify(['Science Fiction']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
  // Bob's own library, with values that overlap none of Alice's — so a
  // resolver that dropped `owner` would produce a visibly wrong list on either
  // side, rather than an accidentally-identical one.
  await harness.prisma.book.create({
    data: {
      userId: harness.bobOwner.userId,
      id: 'd'.repeat(32),
      title: 'Bob One',
      author: 'Terry Pratchett',
      subjects: JSON.stringify(['Humour']),
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

type LibraryData = { viewer: { library: { subjects?: string[]; authors?: string[] } } };

const read = async (field: 'subjects' | 'authors', viewer: Harness['aliceViewer']) => {
  const result = await harness.execute(`{ viewer { library { ${field} } } }`, { viewer });
  expect(result.errors).toBeUndefined();
  return (result.data as LibraryData).viewer.library[field];
};

/**
 * Reads a library field through `Query.user(id:).library` as the admin. This
 * is the assertion that discriminates "reads the owner off its parent" from
 * "re-derives it from the viewer": the config-based admin's own `userId` is
 * null and it owns no books, so a resolver consulting the viewer instead of
 * the parent `Owner` returns an empty list here while every self-read test
 * above keeps passing.
 */
const readAsAdmin = async (field: 'subjects' | 'authors', globalId: string) => {
  const result = await harness.execute(
    `query ($id: ID!) { user(id: $id) { library { ${field} } } }`,
    {
      viewer: harness.adminViewer,
      variables: { id: globalId },
    }
  );
  expect(result.errors).toBeUndefined();
  return (result.data as { user: { library: Record<string, string[]> } }).user.library[field];
};

describe('Library.subjects', () => {
  it('lists the distinct subjects across the library, sorted', async () => {
    expect(await read('subjects', harness.aliceViewer)).toEqual([
      'Fantasy',
      'Fiction',
      'Science Fiction',
    ]);
  });

  it("does not include another user's subjects", async () => {
    // Asserts contents, not just a count: 'Humour' is Bob's alone, so a
    // resolver that queried across users would show it in Alice's list, and
    // Alice's three would show in Bob's.
    expect(await read('subjects', harness.aliceViewer)).not.toContain('Humour');
    expect(await read('subjects', harness.bobViewer)).toEqual(['Humour']);
  });

  it("reads the owner off its parent — an admin sees the target user's subjects", async () => {
    expect(await readAsAdmin('subjects', harness.aliceGlobalId)).toEqual([
      'Fantasy',
      'Fiction',
      'Science Fiction',
    ]);
  });
});

describe('Library.authors', () => {
  it('lists the distinct authors across the library, sorted', async () => {
    expect(await read('authors', harness.aliceViewer)).toEqual(['Ann Leckie', 'Ursula K. Le Guin']);
  });

  it("does not include another user's authors", async () => {
    expect(await read('authors', harness.aliceViewer)).not.toContain('Terry Pratchett');
    expect(await read('authors', harness.bobViewer)).toEqual(['Terry Pratchett']);
  });

  it("reads the owner off its parent — an admin sees the target user's authors", async () => {
    expect(await readAsAdmin('authors', harness.aliceGlobalId)).toEqual([
      'Ann Leckie',
      'Ursula K. Le Guin',
    ]);
  });
});
