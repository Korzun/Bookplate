import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  const userId = harness.aliceOwner.userId;
  const seed = (id: string, title: string, rating: Record<string, number>): Promise<unknown> =>
    harness.prisma.book.create({
      data: { userId, id: id.repeat(32), title, size: 1, mtime: 1, addedAt: 1, ...rating },
    });
  await seed('a', 'Alpha', { ratingOverall: 5, ratingStory: 4, ratedAt: 3 });
  await seed('b', 'Beta', { ratingOverall: 4, ratedAt: 2 });
  await seed('c', 'Gamma', { ratingOverall: 3, ratingWriting: 1, ratedAt: 1 });
  await seed('d', 'Delta', {});
});

afterEach(async () => {
  await harness.cleanup();
});

type Profile = {
  ratedCount: number;
  fields: { field: string; count: number; mean: number | null; distribution: number[] }[];
  favourites: { id: string; title: string; rating: { overall: number } }[];
};

describe('Library.ratingProfile', () => {
  it('resolves the profile for the owner, with favourites as real Book nodes', async () => {
    const result = await harness.execute(
      `{ viewer { library { ratingProfile {
        ratedCount
        fields { field count mean distribution }
        favourites(minOverall: 4, first: 10) { id title rating { overall } }
      } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(result.errors).toBeUndefined();
    const p = (result.data as { viewer: { library: { ratingProfile: Profile } } }).viewer.library
      .ratingProfile;
    expect(p.ratedCount).toBe(3);
    expect(p.fields).toHaveLength(5);
    expect(p.fields[0]).toEqual({
      field: 'OVERALL',
      count: 3,
      mean: 4,
      distribution: [0, 0, 1, 1, 1],
    });
    expect(p.fields.map((f) => f.field)).toEqual([
      'OVERALL',
      'STORY',
      'CHARACTERS',
      'WRITING',
      'IDEAS',
    ]);
    expect(p.favourites.map((b) => b.title)).toEqual(['Alpha', 'Beta']);
    expect(p.favourites[0]!.rating.overall).toBe(5);
    expect(p.favourites[0]!.id).toEqual(expect.any(String));
  });

  it('clamps first to 100 and defaults minOverall to 5', async () => {
    const big = await harness.execute(
      `{ viewer { library { ratingProfile { favourites(first: 1000) { title } } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(big.errors).toBeUndefined();

    const result = await harness.execute(
      `{ viewer { library { ratingProfile { favourites { title } } } } }`,
      { viewer: harness.aliceViewer }
    );
    expect(result.errors).toBeUndefined();
    const p = (result.data as { viewer: { library: { ratingProfile: Profile } } }).viewer.library
      .ratingProfile;
    expect(p.favourites.map((b) => b.title)).toEqual(['Alpha']);
  });

  it('an admin reads a named reader’s profile through user(id:).library', async () => {
    const result = await harness.execute(
      `query ($id: ID!) { user(id: $id) { library { ratingProfile { ratedCount favourites(minOverall: 4) { title } } } } }`,
      { viewer: harness.adminViewer, variables: { id: harness.aliceGlobalId } }
    );
    expect(result.errors).toBeUndefined();
    const p = (result.data as { user: { library: { ratingProfile: Profile } } }).user.library
      .ratingProfile;
    expect(p.ratedCount).toBe(3);
    expect(p.favourites.map((b) => b.title)).toEqual(['Alpha', 'Beta']);
  });
});
