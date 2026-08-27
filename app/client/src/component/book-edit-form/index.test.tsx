import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '~/gql';
import type {
  BookEditFormFragmentFragment,
  BookUpdateMetadataMutation,
  BookUpdateMetadataMutationVariables,
  LibrarySubjectsQuery,
  SeriesNamesQuery,
  SeriesNextIndexQuery,
} from '~/gql/graphql';
import { BookUpdateMetadataDocument } from '~/graphql/book-edit';
import {
  LibrarySubjectsDocument,
  SeriesNamesDocument,
  SeriesNextIndexDocument,
} from '~/graphql/library';
import { BookEditDocument } from '~/page/book-edit';
import { LibraryEntriesDocument } from '~/page/library';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { BookEditForm, BookEditFormFragment } from './index';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';
const NEW_BOOK_ID = 'Qm9vazoy';

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

// `let`, not `const`: the "library id gate" tests below vary both to exercise
// the window before `useCurrentLibraryId` has resolved, mirroring the
// convention `page/book/index.test.tsx` uses for the same stub.
let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;
vi.mock('~/provider/library-target', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/library-target')>();
  return {
    ...actual,
    useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
  };
});

vi.mock('~/lib/staged-upload', () => ({ stageUpload: vi.fn() }));
const { stageUpload } = await import('~/lib/staged-upload');
const mockStage = vi.mocked(stageUpload);

const cover = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });

/**
 * The form's own `book` prop shape. Declared as the CONCRETE fragment type
 * and wrapped with `makeFragmentData` at each call site — plain assignment to
 * `FragmentType<typeof BookEditFormFragment>` fails TypeScript's weak-type
 * check (the same reason `component/my-progress-row/index.test.tsx` documents).
 */
const bookFields = (
  overrides: Partial<BookEditFormFragmentFragment> = {}
): BookEditFormFragmentFragment => ({
  __typename: 'Book',
  id: BOOK_ID,
  title: 'Original Title',
  author: 'Original Author',
  titleSort: '',
  authorSort: '',
  publishDate: '',
  publisher: '',
  series: null,
  seriesIndex: 0,
  description: '',
  subjects: [],
  identifiers: [],
  ...overrides,
});

const book = (overrides: Partial<BookEditFormFragmentFragment> = {}) =>
  makeFragmentData(bookFields(overrides), BookEditFormFragment);

// ---------------------------------------------------------------------------
// Mocks for the three reads the form now issues itself.
// ---------------------------------------------------------------------------

/**
 * Request counters, incremented inside `MockLink`'s VARIABLE-MATCHER form of
 * `request.variables` — a function `MockLink.request()` calls SYNCHRONOUSLY,
 * before any delivery timer. Counted FIRST and matched second on purpose: a
 * read fired with the WRONG variables (which is exactly what a removed `skip`
 * produces — `libraryId: ''`) still increments, so "issues no read" fails
 * CLOSED instead of being silently unmatched. Counting from `result`-as-a-
 * function would count on DELIVERY, at `MockLink`'s random 20-50ms delay,
 * which is how an earlier task shipped an unfalsifiable version of this.
 */
const counters = { subjects: 0, series: 0, save: 0 };

const subjectsMock = (subjects: string[] = []): MockedResponse<LibrarySubjectsQuery> => ({
  request: {
    query: LibrarySubjectsDocument,
    variables: function librarySubjectsVariables(vars) {
      counters.subjects += 1;
      return vars.libraryId === LIBRARY_ID;
    },
  },
  result: {
    data: { __typename: 'Query', node: { __typename: 'Library', id: LIBRARY_ID, subjects } },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
});

const seriesNamesMock = (names: string[] = ['Dune']): MockedResponse<SeriesNamesQuery> => ({
  request: {
    query: SeriesNamesDocument,
    variables: function seriesNamesVariables(vars) {
      counters.series += 1;
      return vars.libraryId === LIBRARY_ID;
    },
  },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        series: names.map((name, i) => ({
          __typename: 'Series' as const,
          id: `U2VyaWVzOj${i}`,
          name,
        })),
      },
    },
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
});

/** `delivered` flips when `MockLink` actually DELIVERS the response — used by
 * the in-flight test below to wait on the response landing instead of on a
 * tuned timeout. `requests` counts at request time (see `counters`). */
const nextIndex = { requests: 0, delivered: 0 };

const nextIndexMock = (
  name: string,
  seriesNextIndex: number,
  delay?: number
): MockedResponse<SeriesNextIndexQuery> => ({
  request: {
    query: SeriesNextIndexDocument,
    variables: function seriesNextIndexVariables(vars) {
      nextIndex.requests += 1;
      return vars.libraryId === LIBRARY_ID && vars.name === name;
    },
  },
  result: () => {
    nextIndex.delivered += 1;
    return {
      data: {
        __typename: 'Query' as const,
        node: { __typename: 'Library' as const, id: LIBRARY_ID, seriesNextIndex },
      },
    };
  },
  maxUsageCount: Number.POSITIVE_INFINITY,
  ...(delay === undefined ? {} : { delay }),
});

/** The `Book` shape `BookUpdateMetadataPayload.book` re-selects. */
const updatePayload = (
  overrides: Partial<{ id: string; title: string }> = {}
): BookUpdateMetadataMutation => ({
  __typename: 'Mutation',
  bookUpdateMetadata: {
    __typename: 'BookUpdateMetadataPayload',
    book: {
      __typename: 'Book',
      id: overrides.id ?? BOOK_ID,
      documentId: 'a'.repeat(32),
      title: overrides.title ?? 'Dune',
      titleSort: 'Dune',
      author: 'Herbert',
      authorSort: 'Herbert, Frank',
      description: '',
      publisher: '',
      publishDate: '',
      seriesIndex: 0,
      subjects: [],
      series: null,
      identifiers: [],
    },
  },
});

/**
 * The save the form sends when NOTHING was edited: every diffable field
 * resolves to `undefined` and is dropped by the GraphQL serializer, so the
 * input is `{ id }` alone. Used by the tests that only care about what the
 * mutation does afterwards.
 */
const saveMock = (
  data: BookUpdateMetadataMutation,
  extraInput: Record<string, unknown> = {},
  delay?: number
): MockedResponse<BookUpdateMetadataMutation, BookUpdateMetadataMutationVariables> => ({
  request: {
    query: BookUpdateMetadataDocument,
    variables: function bookUpdateMetadataVariables(vars) {
      counters.save += 1;
      return JSON.stringify(vars) === JSON.stringify({ input: { id: BOOK_ID, ...extraInput } });
    },
  },
  result: { data },
  // The matcher is the counter, and `MockLink` removes an exhausted mock from
  // its list — so a mock capped at one use would stop counting exactly when a
  // regression fired its SECOND request. Kept alive so the count is real.
  maxUsageCount: Number.POSITIVE_INFINITY,
  ...(delay === undefined ? {} : { delay }),
});

const baseMocks = () => [subjectsMock(), seriesNamesMock()];

// ---------------------------------------------------------------------------
// Cache seeding, carried over from the deleted `use-update-book-metadata`
// test so the eviction assertions still prove something: without a
// pre-existing entity, `not.toContain('Book:<id>')` would pass whether or not
// the `update` function ever ran.
// ---------------------------------------------------------------------------

type Client = ReturnType<typeof renderWithApollo>['client'];

const seedBook = (client: Client, id: string) =>
  client.writeQuery({
    query: BookEditDocument,
    variables: { libraryId: LIBRARY_ID, bookId: id },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          ...bookFields({ id, title: 'Dune' }),
          validation: null,
          hasActionablePendingFix: false,
        },
      },
    },
  });

const libraryEntriesVariables = { libraryId: LIBRARY_ID, first: 20, filter: undefined };

// Deliberately UNANNOTATED: the masked `node` field expects a
// `$fragmentRefs`-wrapped shape, so a literal under an explicit annotation
// would fail TypeScript's excess-property check.
const bookRowNode = (id: string) => ({
  __typename: 'Book' as const,
  id,
  title: 'Dune',
  author: 'Herbert',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
});

const seedLibraryEntries = (client: Client, id: string) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: libraryEntriesVariables,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [
            {
              __typename: 'LibraryEntriesConnectionEdge' as const,
              cursor: 'c1',
              node: bookRowNode(id),
            },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = (client: Client) =>
  client.cache.readQuery({
    query: LibraryEntriesDocument,
    variables: libraryEntriesVariables,
  });

beforeEach(() => {
  counters.subjects = 0;
  counters.series = 0;
  counters.save = 0;
  nextIndex.requests = 0;
  nextIndex.delivered = 0;
  currentLibraryId = LIBRARY_ID;
  currentLibraryIdLoading = false;
  mockStage.mockReset().mockResolvedValue('staged-1');
});

afterEach(() => {
  navigate.mockClear();
});

const save = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save' }));

describe('BookEditForm', () => {
  // `book.id` IS the Relay global id, so Save's post-write navigation uses the
  // mutation PAYLOAD's `id` directly. The payload below carries a visibly
  // different `id` from its `documentId` (the raw hash) so this cannot pass by
  // coincidence if Save ever regresses to navigating with `documentId`.
  it('navigates to the book using the mutation payload id, not its documentId', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: NEW_BOOK_ID }))],
    });

    await save(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(path.book(NEW_BOOK_ID)));
    expect(navigate).not.toHaveBeenCalledWith(path.book('a'.repeat(32)));
  });

  it('stays on the form and shows a save-specific message when the mutation errors', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        ...baseMocks(),
        saveMock({
          __typename: 'Mutation',
          bookUpdateMetadata: {
            __typename: 'BookHashCollisionError',
            message: 'This book collides with another book already in the library.',
          },
        }),
      ],
    });

    await save(user);

    await waitFor(() =>
      expect(
        screen.getByText('This book collides with another book already in the library.')
      ).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a generic save failure when the mutation resolves missing', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock({ __typename: 'Mutation', bookUpdateMetadata: null })],
    });

    await save(user);

    await waitFor(() => expect(screen.getByText("Couldn't save your changes")).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a typed staged-cover expiry with the server message', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        ...baseMocks(),
        saveMock(
          {
            __typename: 'Mutation',
            bookUpdateMetadata: {
              __typename: 'StagedUploadNotFoundError',
              message: 'The staged cover upload has expired. Please try again.',
            },
          },
          { stagedCoverId: 'staged-1' }
        ),
      ],
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, cover);
    await save(user);

    await waitFor(() =>
      expect(
        screen.getByText('The staged cover upload has expired. Please try again.')
      ).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  // The whole point of splitting Save into two phases is that the user can
  // tell WHICH one broke: the message must name the cover and must not read
  // as a generic save failure.
  it('stays on the form and shows a cover-specific message when staging the cover fails', async () => {
    mockStage.mockRejectedValue(new Error('No file uploaded'));
    const user = userEvent.setup();
    // A WORKING save mock is supplied, and the "never fires" half is asserted
    // on `counters.save` — the request-time counter — NOT on the absence of a
    // mock. An unmatched operation is NOT loud: `MockLink` rejects it and
    // Apollo swallows the rejection into the hook's `error` state, so a
    // mock-less version of this test would pass whether or not the mutation
    // fired. (That mistaken belief is what produced two unfalsifiable tests
    // earlier in this same task — see the report's review round.)
    const { container } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload(), { stagedCoverId: 'staged-1' })],
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, cover);
    await save(user);

    const message = await screen.findByText("Couldn't upload the cover image");
    expect(message).toBeInTheDocument();
    expect(screen.queryByText("Couldn't save your changes")).toBeNull();
    expect(counters.save).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Ordering, not mere co-occurrence: the staged id cannot exist before
  // staging, so a mutation carrying `stagedCoverId: 'staged-1'` proves the
  // sequence. The `order` array is the load-bearing assertion — an input
  // missing the staged id would simply fail to match and be swallowed into
  // Apollo's `error` state, not throw.
  it('stages the cover then saves, passing the staged id into the mutation', async () => {
    const order: string[] = [];
    mockStage.mockImplementation(async () => {
      order.push('stage');
      return 'staged-1';
    });
    const user = userEvent.setup();
    const { container } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        ...baseMocks(),
        {
          request: {
            query: BookUpdateMetadataDocument,
            variables: { input: { id: BOOK_ID, stagedCoverId: 'staged-1' } },
          },
          result: () => {
            order.push('mutate');
            return { data: updatePayload({ id: NEW_BOOK_ID }) };
          },
        } satisfies MockedResponse<BookUpdateMetadataMutation, BookUpdateMetadataMutationVariables>,
      ],
    });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, cover);
    await save(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(path.book(NEW_BOOK_ID)));
    expect(mockStage).toHaveBeenCalledWith(cover, 'cover');
    expect(order).toEqual(['stage', 'mutate']);
  });

  it('does not stage when the patch carries no cover', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload())],
    });

    await save(user);

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(mockStage).not.toHaveBeenCalled();
  });

  it('cancels back to the book using the global id', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, { mocks: baseMocks() });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(navigate).toHaveBeenCalledWith(path.book(BOOK_ID));
  });

  // The partial-patch semantic: only a field that actually changed rides in
  // the mutation's input. Asserted by MATCHING on the exact input — `MockLink`
  // rejects any other shape — so an over-wide patch fails loudly rather than
  // being waved through by an `objectContaining`.
  it('sends only the fields that actually changed', async () => {
    const user = userEvent.setup();
    const { container } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        ...baseMocks(),
        saveMock(updatePayload({ title: 'New Title' }), { title: 'New Title' }),
      ],
    });

    const titleInput = container.querySelector('input[name="title"]') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');

    await save(user);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(path.book(BOOK_ID)));
  });

  // The cards are spaced by Page's flex column gap. If the wrapping <form>
  // ever generates a box it swallows them into a single flex item and every
  // gap between the cards disappears, so it has to stay `display: contents`.
  it('keeps the form boxless so the cards stay spaced by the page', () => {
    const { container } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: baseMocks(),
    });
    const form = container.querySelector('form') as HTMLElement;
    expect(form.querySelectorAll(':scope > *').length).toBeGreaterThan(1);
    expect(getComputedStyle(form).display).toBe('contents');
  });

  it('renders the fields it unmasks off its own fragment', () => {
    const { container } = renderWithApollo(
      <BookEditForm
        book={book({ title: 'A Wizard of Earthsea', titleSort: 'Wizard of Earthsea, A' })}
      />,
      { mocks: baseMocks() }
    );

    expect(screen.getByText('Edit Metadata — A Wizard of Earthsea')).toBeInTheDocument();
    const titleSort = container.querySelector('input[name="titleSort"]') as HTMLInputElement;
    expect(titleSort.value).toBe('Wizard of Earthsea, A');
  });
});

// ---------------------------------------------------------------------------
// Cache coherence — transplanted verbatim in intent from the deleted
// `provider/book/hook/use-update-book-metadata.test.tsx`, now driven through
// the form's own Save button because the mutation lives at this call site.
// ---------------------------------------------------------------------------
describe('cache coherence after a save', () => {
  it('evicts the old Book entity when the payload reports a different id', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: NEW_BOOK_ID, title: 'New' }))],
    });
    seedBook(client, BOOK_ID);
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`]).toBeDefined();

    await save(user);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Book:${BOOK_ID}`);
    expect((extracted[`Book:${NEW_BOOK_ID}`] as { title: string }).title).toBe('New');
  });

  it('does not evict when the id is unchanged', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: BOOK_ID, title: 'New' }))],
    });
    seedBook(client, BOOK_ID);

    await save(user);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).toContain(`Book:${BOOK_ID}`);
    expect((extracted[`Book:${BOOK_ID}`] as { title: string }).title).toBe('New');
  });

  // I-1 (whole-branch review): a successful save used to leave the grid's
  // `Library.entries` connection untouched, so the edited book's stale row —
  // or, on an id rotation, an outright DANGLING edge — lived on until a hard
  // reload. Asserted against the cache (`readQuery` returns `null`, i.e. the
  // next read is forced to the network), not a call count.
  it('invalidates the LibraryEntries connection so a subsequent read misses the cache (id rotates)', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: NEW_BOOK_ID, title: 'New' }))],
    });
    seedLibraryEntries(client, BOOK_ID);

    await save(user);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(readEntries(client)).toBeNull();
  });

  // The UNCONDITIONAL half: a title/author/series edit moves a row's sort
  // position or series grouping even when the id holds, so the eviction must
  // not be gated on `payload.book.id !== bookId`.
  it('invalidates the LibraryEntries connection even when the id is unchanged', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: BOOK_ID, title: 'New' }))],
    });
    seedLibraryEntries(client, BOOK_ID);

    await save(user);
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    expect(readEntries(client)).toBeNull();
  });

  it('does not touch the LibraryEntries connection on a failed save', async () => {
    const user = userEvent.setup();
    const { client } = renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        ...baseMocks(),
        saveMock({
          __typename: 'Mutation',
          bookUpdateMetadata: {
            __typename: 'BookHashCollisionError',
            message: 'This book collides with another book already in the library.',
          },
        }),
      ],
    });
    seedLibraryEntries(client, BOOK_ID);

    await save(user);
    await waitFor(() =>
      expect(
        screen.getByText('This book collides with another book already in the library.')
      ).toBeInTheDocument()
    );

    expect(readEntries(client)).not.toBeNull();
  });

  // What actually prevents a double-save at this call site is the Save
  // button being a genuinely disabled native `<button>` while the action is
  // pending (`Button` renders `disabled={disabled || busy}` in submit mode,
  // and `busy` folds in `useActionState`'s `isPending`). Asserted on the
  // REQUEST counter, not on `navigate` call counts: a second save that fired
  // and then failed would ALSO leave `navigate` at 1, so a call-count
  // assertion could not tell the two apart. Goes red the moment
  // `loading: isPending` is dropped from the Save action.
  it('does not send a second request while the first is still in flight', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [...baseMocks(), saveMock(updatePayload({ id: NEW_BOOK_ID }), {}, 40)],
    });

    const button = screen.getByRole('button', { name: /Sav/ });
    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(path.book(NEW_BOOK_ID)));
    expect(counters.save).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The form's own reads, previously `useLibrarySubjects` / `useSeriesNames` /
// `useFetchSeriesNextIndex`.
// ---------------------------------------------------------------------------
describe('library reads', () => {
  it('offers Library.subjects as subject suggestions', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [subjectsMock(['Fantasy', 'Science Fiction']), seriesNamesMock()],
    });

    // `ChipsInput` only reveals its dropdown once the user has typed, and it
    // filters on the typed text — so this asserts the suggestion list really
    // came from `Library.subjects` rather than from anything the form already
    // held (`book.subjects` is empty here).
    await user.type(screen.getByPlaceholderText('Add subject…'), 'Sci');
    expect(await screen.findByRole('option', { name: 'Science Fiction' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Fantasy' })).toBeNull();
  });

  // Order matters: `Library.series` is already sorted server-side (leading
  // articles stripped), and this form must not reorder it. Asserted
  // positionally, not by presence + length, so a reversed list fails.
  it('lists series names in the order the server returned them', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [subjectsMock(), seriesNamesMock(['Earthsea', 'Amber', 'Dune'])],
    });

    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Select…' }));

    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Earthsea', 'Amber', 'Dune']);
  });

  // A failed read degrades to "no suggestions offered" rather than an error
  // state: subjects and series are optional editing candidates, not the
  // screen's content.
  //
  // **The switch click is load-bearing, not scene-setting.** `SeriesNames` is
  // lazy (see the splits below), so with the default `series: null` fixture
  // this test used to leave the read `skip`ped shut — the errored mock was
  // never requested, and the only assertion (the heading) renders
  // unconditionally, so it passed identically with NO mocks at all. Opening
  // the gate first is what makes the failure this test is named for actually
  // happen. `counters.series` pins that: if the read is not issued, the
  // degradation being asserted below describes nothing.
  it('degrades to no series suggestions when the series read fails, without erroring the form', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book()} />, {
      mocks: [
        subjectsMock(),
        {
          request: {
            query: SeriesNamesDocument,
            variables: function seriesNamesErrorVariables(vars) {
              counters.series += 1;
              return vars.libraryId === LIBRARY_ID;
            },
          },
          error: new Error('series read failed'),
        },
      ],
    });

    await screen.findByText('Edit Metadata — Original Title');
    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    await waitFor(() => expect(counters.series).toBe(1));

    // Degraded, not broken: the Select settles OUT of its loading state and
    // still opens — it simply has nothing to offer, so `Select` renders its
    // own "No results" empty option. Three distinct states are being told
    // apart here: still loading, healthy with real names, and degraded-empty.
    // `lists series names in the order the server returned them` reaches this
    // exact point with three real options, which is what makes the empty
    // presentation a discriminator rather than a tautology.
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Select…' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('No results');

    // …and the failure is never reported to the user: the form's own content
    // loaded fine, so a failed SUGGESTION read must not become an error state.
    expect(screen.queryByText(/series read failed/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // The two lazy splits (review round 1, Item 1). Both counters increment
  // inside `MockLink`'s variable matcher — synchronously, in the same tick the
  // operation is issued — so a read that leaked back to eager has already
  // counted before the first `await` resolves and these fail CLOSED.
  // -------------------------------------------------------------------------
  const subjectsInput = () => screen.getByPlaceholderText('Add subject…');

  describe('lazy splits', () => {
    it('does not fetch series names for a book with no series', async () => {
      renderWithApollo(<BookEditForm book={book({ series: null })} />, { mocks: baseMocks() });

      await screen.findByText('Edit Metadata — Original Title');
      expect(counters.series).toBe(0);
    });

    it('fetches series names when the Series switch is turned on', async () => {
      const user = userEvent.setup();
      renderWithApollo(<BookEditForm book={book({ series: null })} />, { mocks: baseMocks() });

      await screen.findByText('Edit Metadata — Original Title');
      await user.click(screen.getByRole('switch', { name: 'isSeries' }));

      // No false-empty flash: the Select reports the in-flight read rather
      // than rendering as "loaded with no series" for the beat between the
      // switch flip and the response.
      expect(screen.getByText('Loading…')).toBeInTheDocument();

      await waitFor(() => expect(counters.series).toBe(1));
      // …and the names actually reach the Select, so this cannot pass on a
      // request that fires but never lands.
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Select…' }));
      expect(await screen.findByRole('option', { name: 'Dune' })).toBeInTheDocument();
    });

    // The other half, and the one that makes the gate `isSeries` rather than
    // `book.series`: a book that ALREADY has a series opens its card on first
    // paint, so the Select must be usable without a second interaction.
    it('fetches series names on mount for a book that already has a series', async () => {
      renderWithApollo(
        <BookEditForm
          book={book({
            series: { __typename: 'Series', id: 'U2VyaWVzOjE=', name: 'Dune' },
            seriesIndex: 1,
          })}
        />,
        { mocks: baseMocks() }
      );

      await waitFor(() => expect(counters.series).toBe(1));
    });

    it('does not fetch library subjects until the subjects field is touched', async () => {
      renderWithApollo(<BookEditForm book={book()} />, { mocks: baseMocks() });

      await screen.findByText('Edit Metadata — Original Title');
      expect(counters.subjects).toBe(0);
    });

    // The COMMITTED half of the subjects split — focus un-skips the real
    // `useQuery` — is pinned by `offers Library.subjects as subject
    // suggestions` above, which drives focus → type → dropdown and so fails
    // if the read never lands. A separate "fires on focus" counter test was
    // written here and DELETED: `counters.subjects` cannot tell the prefetch
    // apart from the committed read (both issue the same operation), so it
    // went green under a mutation that killed the `useQuery` outright.

    // Prefetch on intent: hovering the field warms the cache BEFORE the focus
    // that commits. Asserted with no focus and no typing at all, so it cannot
    // be satisfied by the real `useQuery` un-skipping.
    it('prefetches library subjects on hover of the subjects field, before any focus', async () => {
      const user = userEvent.setup();
      renderWithApollo(<BookEditForm book={book()} />, { mocks: baseMocks() });

      await screen.findByText('Edit Metadata — Original Title');
      await user.hover(subjectsInput());

      await waitFor(() => expect(counters.subjects).toBe(1));
      expect(subjectsInput()).not.toHaveFocus();
      expect(screen.queryByRole('option')).toBeNull();
    });
  });

  describe('library id gate', () => {
    // With NO library id there is nothing to root `node(id:)` on. Asserted on
    // the REQUEST-time counters, not on the absence of a mock: an unmatched
    // operation is swallowed into Apollo's `error` state and the form renders
    // regardless, so "no mocks supplied" alone would pass vacuously.
    //
    // BOTH reads are explicitly ASKED FOR first — the Series switch flipped
    // on, the subjects field focused — so their own lazy gates are open and
    // the library-id gate is the only thing left holding them back. Without
    // that, this test would pass on the lazy gates alone and could not fail
    // when `skipLibraryRead` is removed.
    it('issues no read while there is no library id to root on', async () => {
      currentLibraryId = undefined;
      const user = userEvent.setup();
      renderWithApollo(<BookEditForm book={book()} />, { mocks: baseMocks() });

      expect(await screen.findByText('Edit Metadata — Original Title')).toBeInTheDocument();
      await user.click(screen.getByRole('switch', { name: 'isSeries' }));
      act(() => subjectsInput().focus());

      expect(counters.series).toBe(0);
      // Covers the prefetch's own `skip` too — `usePrefetchOnIntent` fires on
      // that same focus and would otherwise issue the operation itself.
      expect(counters.subjects).toBe(0);
    });

    // A SKIPPED `useQuery` reports `loading: false` on its own. Without
    // folding `useCurrentLibraryId`'s own bootstrap loading in, the series
    // Select would render as "loaded and empty" for the whole ViewerBootstrap
    // window — a false "no series yet".
    it('keeps the series Select in its loading state while the library id resolves', async () => {
      currentLibraryId = undefined;
      currentLibraryIdLoading = true;
      const user = userEvent.setup();
      renderWithApollo(<BookEditForm book={book()} />, { mocks: [] });

      await user.click(screen.getByRole('switch', { name: 'isSeries' }));
      // `Select` renders the literal text "Loading…" in place of its
      // placeholder while `loading` is set, and refuses to open. Without the
      // `|| libraryIdLoading` fold this would read "Select…" with an empty
      // option list — a false "no series yet" for the whole bootstrap window.
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('Select…')).toBeNull();
    });
  });
});

describe('series order auto-fill', () => {
  const seriesInput = () => document.querySelector('input[name="seriesIndex"]') as HTMLInputElement;

  async function openSeriesAndPick(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    // `Select` refuses to open while `loading`, so wait for `SeriesNames` to
    // land first. (`Loading…` is the trigger's own copy for that state.)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), name);
    await user.keyboard('{Enter}');
  }

  it('fills empty Order with the fetched next index for an existing series', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book({ series: null, seriesIndex: 0 })} />, {
      mocks: [...baseMocks(), nextIndexMock('Dune', 4)],
    });
    await openSeriesAndPick(user, 'Dune');
    await waitFor(() => expect(seriesInput().value).toBe('4'));
  });

  it('fills Order with 1 for a brand-new series', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book({ series: null, seriesIndex: 0 })} />, {
      mocks: [...baseMocks(), nextIndexMock('Brand New', 1)],
    });
    await openSeriesAndPick(user, 'Brand New');
    await waitFor(() => expect(seriesInput().value).toBe('1'));
  });

  // Leaves Order empty on failure rather than surfacing an error.
  it('leaves Order untouched when the next-index query errors', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book({ series: null, seriesIndex: 0 })} />, {
      mocks: [
        ...baseMocks(),
        {
          request: {
            query: SeriesNextIndexDocument,
            variables: function seriesNextIndexErrorVariables(vars) {
              nextIndex.requests += 1;
              return vars.libraryId === LIBRARY_ID && vars.name === 'Dune';
            },
          },
          error: new Error('next index unavailable'),
        },
      ],
    });
    await openSeriesAndPick(user, 'Dune');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Search' })).toBeNull());
    // The fetch WAS issued — otherwise this would pass for the wrong reason
    // (an unchanged Order because nothing ever asked).
    expect(nextIndex.requests).toBe(1);
    // `0` is `NumberInput`'s own rendering of the untouched `seriesIndex: 0`
    // this book carries — i.e. unchanged. A resolved fetch would have written
    // the fetched index here instead.
    expect(seriesInput().value).toBe('0');
  });

  // A WORKING `nextIndexMock` is supplied deliberately: the assertion is that
  // the fetch is never ISSUED (`nextIndex.requests`, counted synchronously
  // inside `MockLink.request()`), not merely that nothing came back. With no
  // mock at all, a fetch that fired would be rejected and swallowed by the
  // caller's own `.catch`, leaving the Order at '2' either way — the test
  // would pass whether or not the guard existed.
  it('does not overwrite an Order the user already entered', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book({ series: null, seriesIndex: 0 })} />, {
      mocks: [...baseMocks(), nextIndexMock('Dune', 4)],
    });
    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    await user.type(seriesInput(), '2');
    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Dune');
    await user.keyboard('{Enter}');
    expect(nextIndex.requests).toBe(0);
    expect(seriesInput().value).toBe('2');
  });

  it('does not overwrite an Order typed while the next-index fetch is still in flight', async () => {
    const user = userEvent.setup();
    renderWithApollo(<BookEditForm book={book({ series: null, seriesIndex: 0 })} />, {
      mocks: [...baseMocks(), nextIndexMock('Dune', 4, 60)],
    });
    await openSeriesAndPick(user, 'Dune');

    // The fetch is still pending here; type an Order before it resolves.
    await user.type(seriesInput(), '2');
    expect(nextIndex.delivered).toBe(0);

    // Wait on the RESPONSE actually landing, not on a tuned timeout: without
    // this the assertion below could run before the fetch resolved and pass
    // for the wrong reason. `nextIndex.delivered` flips inside the mock's own
    // `result` function, i.e. at delivery.
    await waitFor(() => expect(nextIndex.delivered).toBe(1));
    // One more microtask/macrotask turn so the `.then` that would clobber the
    // value has definitely run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(seriesInput().value).toBe('2');
  });
});
