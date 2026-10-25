import { createHarness, type Harness } from '../graphql/test-util';
import { favouriteBooks, ratedCount, ratingSummaries } from './rating-profile';

vi.mock('../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const seed = (
  userId: string,
  id: string,
  title: string,
  rating: Record<string, number> = {}
): Promise<unknown> =>
  harness.prisma.book.create({
    data: { userId, id: id.repeat(32), title, size: 1, mtime: 1, addedAt: 1, ...rating },
  });

describe('rating profile service', () => {
  it('empty library: ratedCount 0, every mean null, zero distributions, no favourites', async () => {
    const userId = harness.aliceOwner.userId;
    expect(await ratedCount(harness.prisma, userId)).toBe(0);
    const summaries = await ratingSummaries(harness.prisma, userId);
    expect(summaries.map((s) => s.field)).toEqual([
      'overall',
      'story',
      'characters',
      'writing',
      'ideas',
    ]);
    for (const s of summaries) {
      expect(s).toMatchObject({ count: 0, mean: null, distribution: [0, 0, 0, 0, 0] });
    }
    expect(await favouriteBooks(harness.prisma, userId, 1, 25)).toEqual([]);
  });

  it('counts, means and distributions per field over a mixed library', async () => {
    const userId = harness.aliceOwner.userId;
    await seed(userId, 'a', 'A', { ratingOverall: 5, ratingStory: 4, ratedAt: 3 });
    await seed(userId, 'b', 'B', {
      ratingOverall: 3,
      ratingStory: 4,
      ratingWriting: 1,
      ratedAt: 2,
    });
    await seed(userId, 'c', 'C');

    expect(await ratedCount(harness.prisma, userId)).toBe(2);
    const by = Object.fromEntries(
      (await ratingSummaries(harness.prisma, userId)).map((s) => [s.field, s])
    );
    expect(by.overall).toEqual({
      field: 'overall',
      count: 2,
      mean: 4,
      distribution: [0, 0, 1, 0, 1],
    });
    expect(by.story).toMatchObject({ count: 2, mean: 4, distribution: [0, 0, 0, 2, 0] });
    expect(by.writing).toMatchObject({ count: 1, mean: 1, distribution: [1, 0, 0, 0, 0] });
    expect(by.characters).toMatchObject({ count: 0, mean: null });
    expect(by.ideas).toMatchObject({ count: 0, mean: null });
  });

  it('favourites honour minOverall, order by ratedAt desc, and take first', async () => {
    const userId = harness.aliceOwner.userId;
    await seed(userId, 'a', 'A', { ratingOverall: 5, ratedAt: 3 });
    await seed(userId, 'b', 'B', { ratingOverall: 3, ratedAt: 2 });
    await seed(userId, 'd', 'D', { ratingOverall: 4, ratedAt: 1 });

    const titles = async (min: number, first: number): Promise<string[]> =>
      (await favouriteBooks(harness.prisma, userId, min, first)).map((b) => b.title);
    expect(await titles(4, 2)).toEqual(['A', 'D']);
    expect(await titles(5, 2)).toEqual(['A']);
    expect(await titles(4, 1)).toEqual(['A']);
  });

  it('ignores another reader’s books', async () => {
    await seed(harness.bobOwner.userId, 'a', 'Bob', { ratingOverall: 5, ratedAt: 1 });
    const userId = harness.aliceOwner.userId;
    expect(await ratedCount(harness.prisma, userId)).toBe(0);
    expect((await ratingSummaries(harness.prisma, userId))[0]).toMatchObject({ count: 0 });
    expect(await favouriteBooks(harness.prisma, userId, 1, 25)).toEqual([]);
  });
});
