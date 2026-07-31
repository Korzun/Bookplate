import { createHarness, type Harness } from '../../test-util';

vi.mock('../../../logger');

let harness: Harness;
const BOOK_ID = 'd'.repeat(32);

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
  await harness.prisma.validation.create({
    data: {
      userId: harness.aliceOwner.userId,
      bookId: BOOK_ID,
      valid: false,
      threshold: 'ERROR',
      validatedAt: 1_700_000_000_000,
      messages: {
        create: [
          {
            seq: 0,
            code: 'RSC-005',
            severity: 'ERROR',
            message: 'bad',
            path: 'OEBPS/x.xhtml',
            line: 4,
            column: 2,
          },
        ],
      },
    },
  });
});

afterEach(async () => {
  await harness.cleanup();
});

describe('Book.validation', () => {
  it('exposes the stored validation with its messages', async () => {
    const result = await harness.execute(
      `{ viewer { library { book(id: "${BOOK_ID}") { validation { valid threshold validatedAt messages { code severity message path line column } } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    const validation = (
      result.data as {
        viewer: { library: { book: { validation: { valid: boolean; messages: unknown[] } } } };
      }
    ).viewer.library.book.validation;
    expect(validation.valid).toBe(false);
    expect(validation.messages).toEqual([
      {
        code: 'RSC-005',
        severity: 'ERROR',
        message: 'bad',
        path: 'OEBPS/x.xhtml',
        line: 4,
        column: 2,
      },
    ]);
  });

  it('is null for a book that has never been validated', async () => {
    await harness.prisma.book.create({
      data: {
        userId: harness.aliceOwner.userId,
        id: 'e'.repeat(32),
        title: 'Fresh',
        size: 1,
        mtime: 1,
        addedAt: 1,
      },
    });

    const result = await harness.execute(
      `{ viewer { library { book(id: "${'e'.repeat(32)}") { validation { valid } } } } }`,
      { viewer: harness.aliceViewer }
    );

    expect(result.errors).toBeUndefined();
    expect(
      (result.data as { viewer: { library: { book: { validation: unknown } } } }).viewer.library
        .book.validation ?? null
    ).toBeNull();
  });
});
