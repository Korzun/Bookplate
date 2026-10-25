import { encodeGlobalID } from '@pothos/plugin-relay';

import { assertValidEpub } from '../../../../services/epub-validator';
import { createHarness, type Harness } from '../../../test-util';
import { rawBookId, seedEditableBook } from './test-helpers';

vi.mock('../../../../logger');
// Call-through, as in update-metadata.test.ts: the id-change test runs the
// real bookUpdateMetadata against the fixture EPUB.
vi.mock('../../../../services/book-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/book-lifecycle')>();
  return { ...actual, reimportBook: vi.fn(actual.reimportBook) };
});
vi.mock('../../../../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/epub-validator')>();
  return { ...actual, assertValidEpub: vi.fn() };
});

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  // vite.config.ts's `mockReset: true` wipes the factory default each test.
  vi.mocked(assertValidEpub).mockResolvedValue({
    valid: true,
    fatal: false,
    threshold: 'ERROR' as const,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  });
});

afterEach(async () => {
  await harness.cleanup();
  vi.clearAllMocks();
});

const BOOK_ID = 'a'.repeat(32);

const MUTATION = `
  mutation Rate($input: BookRateInput!) {
    bookRate(input: $input) {
      __typename
      ... on BookRatePayload {
        book { id rating { overall story characters writing ideas } }
      }
      ... on InvalidInputError { issues { path message } }
    }
  }
`;

const UPDATE_METADATA = `
  mutation Update($input: BookUpdateMetadataInput!) {
    bookUpdateMetadata(input: $input) {
      __typename
      ... on BookUpdateMetadataPayload { book { id } }
    }
  }
`;

type Rating = {
  overall: number | null;
  story: number | null;
  characters: number | null;
  writing: number | null;
  ideas: number | null;
};

type RateData = { __typename: string; book: { id: string; rating: Rating } };

const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

const ratingRow = async (userId: string, id: string) =>
  harness.prisma.book.findUniqueOrThrow({
    where: { userId_id: { userId, id } },
    select: {
      ratingOverall: true,
      ratingStory: true,
      ratingCharacters: true,
      ratingWriting: true,
      ratingIdeas: true,
      ratedAt: true,
    },
  });

const rate = (viewer: Harness['aliceViewer'], userId: string, id: string, fields: object) =>
  harness.execute(MUTATION, {
    viewer,
    variables: { input: { id: bookGlobalId(userId, id), ...fields } },
  });

describe('Mutation.bookRate', () => {
  it('sets all five ratings and stamps ratedAt', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Rated');
    const before = Date.now();

    const fields = { overall: 4, story: 3, characters: 5, writing: 2, ideas: 1 };
    const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, fields);

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRate as RateData;
    expect(data.__typename).toBe('BookRatePayload');
    expect(data.book.rating).toEqual(fields);
    const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
    expect(row.ratedAt).toBeGreaterThanOrEqual(before);
    expect(row.ratedAt).toBeLessThanOrEqual(Date.now());
  });

  it('sets one field and leaves the other four untouched', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Partial');
    await harness.prisma.book.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
      data: { ratingOverall: 4 },
    });

    const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, {
      story: 5,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data!.bookRate as RateData).book.rating).toEqual({
      overall: 4,
      story: 5,
      characters: null,
      writing: null,
      ideas: null,
    });
  });

  it('explicit null clears, including all five at once, and still stamps ratedAt', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Cleared');
    await harness.prisma.book.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
      data: {
        ratingOverall: 3,
        ratingStory: 3,
        ratingCharacters: 3,
        ratingWriting: 3,
        ratingIdeas: 3,
        ratedAt: 1,
      },
    });

    const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, {
      overall: null,
      story: null,
      characters: null,
      writing: null,
      ideas: null,
    });

    expect(result.errors).toBeUndefined();
    expect((result.data!.bookRate as RateData).book.rating).toEqual({
      overall: null,
      story: null,
      characters: null,
      writing: null,
      ideas: null,
    });
    const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
    expect(row.ratedAt).toBeGreaterThan(1);
  });

  it('an input with only id is a no-op that returns the payload', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Noop');
    await harness.prisma.book.update({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: BOOK_ID } },
      data: { ratingOverall: 2, ratedAt: 7 },
    });

    const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, {});

    expect(result.errors).toBeUndefined();
    const data = result.data?.bookRate as RateData;
    expect(data.__typename).toBe('BookRatePayload');
    expect(data.book.rating.overall).toBe(2);
    const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
    expect(row.ratedAt).toBe(7);
  });

  it.each([0, 6, -1])(
    'returns InvalidInputError naming the field for %s and writes nothing',
    async (value) => {
      await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Invalid');

      const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, {
        overall: 5,
        writing: value,
      });

      expect(result.errors).toBeUndefined();
      const data = result.data?.bookRate as {
        __typename: string;
        issues: { path: string[]; message: string }[];
      };
      expect(data.__typename).toBe('InvalidInputError');
      expect(data.issues[0]?.path).toEqual(['writing']);
      const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
      expect(row.ratingOverall).toBeNull();
      expect(row.ratingWriting).toBeNull();
      expect(row.ratedAt).toBeNull();
    }
  );

  it('resolves to null when the book does not exist for the viewer', async () => {
    const result = await rate(harness.aliceViewer, harness.aliceOwner.userId, 'no-such-book', {
      overall: 3,
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRate).toBeNull();
  });

  it('refuses another reader with FORBIDDEN and null data, leaving the row unchanged', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s');

    const result = await rate(harness.bobViewer, harness.aliceOwner.userId, BOOK_ID, {
      overall: 1,
    });

    const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
    expect(row.ratingOverall).toBeNull();
    expect(row.ratedAt).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookRate ?? null).toBeNull();
  });

  it('refuses the admin viewer with FORBIDDEN (owner-only, unlike other book mutations)', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Alice’s');

    const result = await rate(harness.adminViewer, harness.aliceOwner.userId, BOOK_ID, {
      overall: 1,
    });

    const row = await ratingRow(harness.aliceOwner.userId, BOOK_ID);
    expect(row.ratingOverall).toBeNull();
    expect(row.ratedAt).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.bookRate ?? null).toBeNull();
  });

  it('survives a title edit that changes the book id', async () => {
    await seedEditableBook(harness, harness.aliceOwner, BOOK_ID, 'Before');
    await rate(harness.aliceViewer, harness.aliceOwner.userId, BOOK_ID, { overall: 5 });

    const edit = await harness.execute(UPDATE_METADATA, {
      viewer: harness.aliceViewer,
      variables: {
        input: { id: bookGlobalId(harness.aliceOwner.userId, BOOK_ID), title: 'Renamed' },
      },
    });

    expect(edit.errors).toBeUndefined();
    const newId = rawBookId((edit.data!.bookUpdateMetadata as { book: { id: string } }).book.id);
    expect(newId).not.toBe(BOOK_ID);
    expect((await ratingRow(harness.aliceOwner.userId, newId)).ratingOverall).toBe(5);
  });
});
