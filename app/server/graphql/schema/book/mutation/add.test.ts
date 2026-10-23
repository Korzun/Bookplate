import { createHarness, type Harness } from '../../../test-util';
import { EMPTY_COUNTS, fixtureEpub, rawBookId } from './test-helpers';

vi.mock('../../../../logger');
vi.mock('../../../../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/epub-validator')>();
  return { ...actual, assertValidEpub: vi.fn(), validateEpubReport: vi.fn() };
});

import {
  assertValidEpub,
  EpubValidationError,
  validateEpubReport,
} from '../../../../services/epub-validator';

const okReport = {
  valid: true,
  fatal: false,
  threshold: 'ERROR' as const,
  messages: [],
  counts: EMPTY_COUNTS,
};

const ADD = `
  mutation Add($input: BookAddInput!) {
    bookAdd(input: $input) {
      __typename
      ... on BookAddPayload { book { id title author } autoFixes { field } proposals { field } }
      ... on UserError { message }
      ... on EpubValidationError { messages { code } }
      ... on BookHashCollisionError { collidingBook { id title } }
    }
  }
`;

type AddResult = {
  __typename: string;
  message?: string;
  book?: { id: string; title: string; author: string };
  collidingBook?: { id: string; title: string };
  messages?: { code: string }[];
};

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  // `mockReset: true` (vite.config.ts) wipes factory defaults before each test.
  vi.mocked(assertValidEpub).mockResolvedValue(okReport);
  vi.mocked(validateEpubReport).mockResolvedValue(okReport);
});

afterEach(async () => {
  await harness.cleanup();
});

const stageFor = (userId: string, bytes: Buffer, name = 'Dune.epub') =>
  harness.replaceStaging.stage(bytes, userId, name, 'epub');

async function add(stagedUploadId: string, viewer = harness.aliceViewer): Promise<AddResult> {
  const result = await harness.execute(ADD, { viewer, variables: { input: { stagedUploadId } } });
  expect(result.errors).toBeUndefined();
  return (result.data as { bookAdd: AddResult }).bookAdd;
}

describe('bookAdd', () => {
  it("adds a staged EPUB to the viewer's library and consumes the staged upload", async () => {
    const id = stageFor(harness.aliceOwner.userId, fixtureEpub('Dune', 'Frank Herbert'));

    const result = await add(id);

    expect(result.__typename).toBe('BookAddPayload');
    expect(result.book).toMatchObject({ title: 'Dune', author: 'Frank Herbert' });
    const row = await harness.prisma.book.findUnique({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: rawBookId(result.book!.id) } },
    });
    expect(row?.title).toBe('Dune');
    expect(harness.replaceStaging.resolve(id, harness.aliceOwner.userId)).toBeNull();
  });

  it('falls back to the uploaded file name when the EPUB has no title', async () => {
    const id = stageFor(harness.aliceOwner.userId, fixtureEpub(''), 'My Notes.epub');
    const result = await add(id);
    expect(result.book?.title).toBe('My Notes');
  });

  it('refuses an EPUB that fails validation, and consumes the upload', async () => {
    vi.mocked(assertValidEpub).mockRejectedValue(
      new EpubValidationError(
        [{ id: 'RSC-001', severity: 'ERROR', message: 'Broken' }],
        { ...EMPTY_COUNTS, ERROR: 1 },
        'ERROR'
      )
    );
    const id = stageFor(harness.aliceOwner.userId, fixtureEpub('Broken'));

    const result = await add(id);

    expect(result.__typename).toBe('EpubValidationError');
    expect(result.messages).toEqual([{ code: 'RSC-001' }]);
    expect(await harness.prisma.book.count()).toBe(0);
    expect(harness.replaceStaging.resolve(id, harness.aliceOwner.userId)).toBeNull();
  });

  it('refuses a file that is not an EPUB at all', async () => {
    const id = stageFor(harness.aliceOwner.userId, Buffer.from('not a zip'));
    const result = await add(id);
    expect(result.__typename).toBe('EpubValidationError');
    expect(result.message).toMatch(/^Failed to parse EPUB/);
    expect(result.messages).toEqual([]);
  });

  it('answers a duplicate with the book already in the library', async () => {
    const bytes = fixtureEpub('Dune');
    const first = await add(stageFor(harness.aliceOwner.userId, bytes));

    const second = await add(stageFor(harness.aliceOwner.userId, bytes));

    expect(second.__typename).toBe('BookHashCollisionError');
    expect(second.collidingBook).toEqual({ id: first.book!.id, title: 'Dune' });
  });

  it("cannot consume another reader's staged upload", async () => {
    const id = stageFor(harness.bobOwner.userId, fixtureEpub('Bob book'));

    const result = await add(id);

    expect(result.__typename).toBe('StagedUploadNotFoundError');
    expect(harness.replaceStaging.resolve(id, harness.bobOwner.userId)).not.toBeNull();
  });

  it('answers an unknown staged id as not found', async () => {
    expect((await add('no-such-upload')).__typename).toBe('StagedUploadNotFoundError');
  });

  it('refuses the config admin, which owns no library', async () => {
    const result = await harness.execute(ADD, {
      viewer: harness.adminViewer,
      variables: { input: { stagedUploadId: 'x' } },
    });
    expect(result.errors?.[0].extensions?.code).toBe('FORBIDDEN');
  });
});
