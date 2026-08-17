import { encodeGlobalID } from '@pothos/plugin-relay';

import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'd'.repeat(32);

// Computed the same way the resolver decodes/re-encodes it — mirrors
// `validation/model.test.ts`'s identical helper.
const bookGlobalId = (userId: string, id: string): string =>
  encodeGlobalID('Book', JSON.stringify([userId, id]));

type SegmentsData = {
  viewer: {
    library: {
      book: {
        validation: {
          messages: {
            edges: { node: { segments: { text: string; subject: boolean }[] } }[];
          };
        };
      };
    };
  };
};

beforeEach(async () => {
  harness = await createHarness();
  await harness.prisma.book.create({
    data: {
      userId: harness.aliceOwner.userId,
      id: BOOK_ID,
      title: 'Broken',
      size: 1,
      mtime: 1,
      addedAt: 1,
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

async function seedMessage(message: string): Promise<void> {
  await harness.prisma.validation.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      valid: false,
      threshold: 'ERROR',
      validatedAt: 1,
      messages: {
        create: [{ seq: 0, code: 'RSC-005', severity: 'ERROR', message }],
      },
    },
  });
}

async function readSegments(): Promise<{ text: string; subject: boolean }[]> {
  const gid = bookGlobalId(harness.aliceOwner.userId, BOOK_ID);
  const result = await harness.execute(
    `{ viewer { library { book(id: "${gid}") { validation { messages(first: 10) { edges { node { segments { text subject } } } } } } } } }`,
    { viewer: harness.aliceViewer }
  );
  expect(result.errors).toBeUndefined();
  return (result.data as SegmentsData).viewer.library.book.validation.messages.edges[0].node
    .segments;
}

describe('ValidationMessage.segments', () => {
  it('splits a message into prose and subject runs', async () => {
    await seedMessage('Referenced resource "a/b.xhtml" could not be found.');

    const segments = await readSegments();

    expect(segments.some((s) => s.subject === true)).toBe(true);
    // Quotes are stripped from the subject run, not merely rendered — the
    // full text, rejoined, must not still contain the delimiting `"`.
    expect(segments.map((s) => s.text).join('')).not.toContain('"');
  });

  it('returns a single non-subject run for a message with no quoted span', async () => {
    await seedMessage('plain message');

    const segments = await readSegments();

    expect(segments).toEqual([{ text: 'plain message', subject: false }]);
  });
});
