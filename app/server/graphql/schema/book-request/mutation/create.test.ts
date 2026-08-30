import { MAX_OPEN_BOOK_REQUESTS } from '../../../../services/book-request';
import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const MUTATION = `
  mutation Create($input: BookRequestCreateInput!) {
    bookRequestCreate(input: $input) {
      __typename
      ... on BookRequestCreatePayload { bookRequest { title author note status } }
      ... on InvalidInputError { message issues { path message } }
      ... on BookRequestLimitExceededError { message limit }
      ... on DuplicateBookRequestError { message existingRequestId }
    }
  }
`;

const validInput = (overrides: Record<string, unknown> = {}) => ({
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  ...overrides,
});

describe('Mutation.bookRequestCreate', () => {
  it('creates a pending request for a reader', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ note: 'any edition' }) },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.bookRequestCreate).toEqual({
      __typename: 'BookRequestCreatePayload',
      bookRequest: {
        title: 'Dune',
        author: 'Frank Herbert',
        note: 'any edition',
        status: 'PENDING',
      },
    });
  });

  it('refuses an empty title', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: '   ' }) },
    });

    const payload = result.data?.bookRequestCreate as {
      __typename: string;
      issues: { path: string[] }[];
    };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['title']);
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses an empty author', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ author: '' }) },
    });
    const payload = result.data?.bookRequestCreate as {
      __typename: string;
      issues: { path: string[] }[];
    };
    expect(payload.__typename).toBe('InvalidInputError');
    expect(payload.issues.map((i) => i.path)).toContainEqual(['author']);
  });

  it('reports the duplicate, with the id of the request already open', async () => {
    await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput() },
    });
    const existing = await harness.prisma.bookRequest.findFirstOrThrow();

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: 'DUNE' }) },
    });

    expect(result.data?.bookRequestCreate).toEqual({
      __typename: 'DuplicateBookRequestError',
      message: 'You have already requested this book.',
      existingRequestId: existing.id,
    });
  });

  it('reports the cap once it is reached', async () => {
    for (let n = 0; n < MAX_OPEN_BOOK_REQUESTS; n++) {
      await harness.execute(MUTATION, {
        viewer: harness.aliceViewer,
        variables: { input: validInput({ title: `Book ${n}` }) },
      });
    }

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: validInput({ title: 'One too many' }) },
    });

    const payload = result.data?.bookRequestCreate as { __typename: string; limit: number };
    expect(payload.__typename).toBe('BookRequestLimitExceededError');
    expect(payload.limit).toBe(MAX_OPEN_BOOK_REQUESTS);
  });

  it('refuses the config admin, which has no User row to own a request', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: validInput() },
    });

    expect(result.data?.bookRequestCreate ?? null).toBeNull();
    expect(result.errors).toBeDefined();
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: null,
      variables: { input: validInput() },
    });
    expect(result.errors).toBeDefined();
    expect(await harness.prisma.bookRequest.count()).toBe(0);
  });
});
