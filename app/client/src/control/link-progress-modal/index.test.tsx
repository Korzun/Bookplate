import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { ApolloProvider, useQuery } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyProgressListDocument } from '~/component/my-progress-content';
import { ProgressRowFragment } from '~/component/my-progress-row';
import type {
  BookLinkDocumentMutation,
  BookLinkDocumentMutationVariables,
  LineageType,
  LinkPickerBooksQuery,
  LinkPickerBooksQueryVariables,
  MyProgressListQuery,
  MyProgressListQueryVariables,
  ProgressRowFragmentFragment,
} from '~/gql/graphql';
import { BookLinkDocumentDocument, LinkPickerBooksDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { LinkProgressModal } from './index';

const LIBRARY_ID = 'lib-1';
const DOCUMENT_ID = 'doc-orphan-hash';
const PROGRESS_ID = 'progress-orphan-1';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

type LibraryNode = Extract<NonNullable<LinkPickerBooksQuery['node']>, { __typename: 'Library' }>;
type PickerEdge = LibraryNode['entries']['edges'][number];

const bookEdge = (id: string, title: string, author: string): PickerEdge => ({
  __typename: 'LibraryEntriesConnectionEdge',
  cursor: id,
  node: { __typename: 'Book', id, title, author },
});

const seriesEdge = (id: string): PickerEdge => ({
  __typename: 'LibraryEntriesConnectionEdge',
  cursor: id,
  node: { __typename: 'Series' },
});

/**
 * `after` is deliberately OMITTED from the request variables when `after`
 * itself is `undefined` — the component's own `variables: { libraryId, query
 * ... }` literal never includes an `after` key on the initial fetch, and an
 * explicit `after: undefined` key is a DISTINCT shape from an omitted key as
 * far as `MockLink`'s `@wry/equality` matching is concerned (same rule
 * `use-search-suggestions.ts`'s and `use-library-entries.test.tsx`'s own
 * mocks already follow). `query` stays always-present (even `undefined`) to
 * match the component's `query: debouncedFilter || undefined`, which always
 * includes the key.
 */
const pickerMock = (
  query: string | undefined,
  edges: PickerEdge[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  }
): MockedResponse<LinkPickerBooksQuery, LinkPickerBooksQueryVariables> => ({
  request: {
    query: LinkPickerBooksDocument,
    variables: { libraryId: LIBRARY_ID, query },
  },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges,
          pageInfo: { __typename: 'PageInfo', ...pageInfo },
        },
      },
    },
  },
});

const linkSuccessMock = (
  bookId: string,
  lineage: {
    __typename: 'LinkedDocument';
    oldId: string;
    newId: string;
    type: LineageType;
  }[] = []
): MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> => ({
  request: {
    query: BookLinkDocumentDocument,
    variables: { id: bookId, documentId: DOCUMENT_ID },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookLinkDocument: {
        __typename: 'BookLinkDocumentPayload',
        book: { __typename: 'Book', id: bookId, lineage },
      },
    },
  },
});

const linkNetworkErrorMock = (
  bookId: string
): MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> => ({
  request: {
    query: BookLinkDocumentDocument,
    variables: { id: bookId, documentId: DOCUMENT_ID },
  },
  error: new Error('Network error'),
});

/** `MyProgressList`'s own variables at `first: 50, after: null` — the shape `usePaginatedConnection` sends on a first page. */
const myProgressListVariables = {
  libraryId: LIBRARY_ID,
  first: 50,
  after: null,
};

/**
 * A typed `ProgressRowFragmentFragment` VARIABLE, never an inline object
 * literal at a `MyProgressListQuery` call site — see
 * `component/my-progress-row/index.test.tsx`'s identical note on why a
 * fresh literal fails TypeScript's excess-property check against the
 * MASKED `node` field `MyProgressListDocument`'s edges carry.
 */
const progressRow = (
  overrides: Partial<{
    id: string;
    document: string;
    book: ProgressRowFragmentFragment['book'];
  }> = {}
): ProgressRowFragmentFragment => ({
  __typename: 'Progress',
  id: overrides.id ?? PROGRESS_ID,
  document: overrides.document ?? DOCUMENT_ID,
  percentage: 0.1,
  currentChapter: 1,
  device: 'Kobo',
  timestamp: '2026-01-01T00:00:00.000Z',
  book: overrides.book !== undefined ? overrides.book : null,
});

/**
 * A minimal, ACTIVE `useQuery(MyProgressListDocument)` watcher, rendered
 * alongside the modal under test — mirrors the deleted
 * `use-progress-mutations.test.tsx`'s own `useLinkProgressWithActiveList`
 * combined-hook shape (Task 4 dissolved that hook's tests into this file).
 * A field-level `cache.evict` only actually forces a refetch for a query
 * that is being WATCHED; without a live consumer like this, the eviction
 * would be unobservable from a plain `cache.extract()`/`readQuery()` check
 * alone (Apollo's `cache-first` refetch is a `useQuery`-level behaviour).
 */
const ProbeMyProgressList = () => {
  const { data } = useQuery(MyProgressListDocument, {
    variables: myProgressListVariables,
  });
  const edges = data?.node?.__typename === 'Library' ? data.node.progress.edges : undefined;
  return <div data-testid="probe">{edges?.[0]?.node.id ?? 'none'}</div>;
};

const linkAlreadyLinkedMock = (
  bookId: string
): MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> => ({
  request: {
    query: BookLinkDocumentDocument,
    variables: { id: bookId, documentId: DOCUMENT_ID },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookLinkDocument: {
        __typename: 'DocumentAlreadyLinkedError',
        message: 'This document is already linked to another book',
      },
    },
  },
});

/**
 * Seeds the orphan `Progress` entity directly into a REAL `InMemoryCache`
 * (mirrors `use-progress-mutations.test.tsx`'s own eviction test), so a link
 * test can prove `useLinkProgress`'s eviction actually fires through this
 * modal, not merely that the mutation itself resolves.
 */
const seedOrphanProgress = (client: ApolloClient) => {
  client.cache.writeFragment({
    id: client.cache.identify({ __typename: 'Progress', id: PROGRESS_ID }),
    fragment: ProgressRowFragment,
    data: {
      __typename: 'Progress',
      id: PROGRESS_ID,
      document: DOCUMENT_ID,
      percentage: 0.1,
      currentChapter: 1,
      device: 'Kobo',
      timestamp: '2026-01-01T00:00:00.000Z',
      book: null,
    },
  });
};

const renderModal = (
  props: Partial<ComponentProps<typeof LinkProgressModal>> = {},
  mocks: MockedResponse[] = []
) =>
  renderWithApollo(
    <LinkProgressModal
      isOpen
      documentId={DOCUMENT_ID}
      libraryId={LIBRARY_ID}
      progressId={PROGRESS_ID}
      onClose={vi.fn()}
      {...props}
    />,
    { mocks }
  );

describe('LinkProgressModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Brief-required. Two DISTINCT mocks, keyed on two DISTINCT `query`
  // variables, returning two DISTINCT (unrelated) books — proving the
  // TYPED text reaches the server as a filter variable and the displayed
  // result is the SERVER's response for that exact query, not a client-side
  // filter over the first fetch's results (which would still show "Dune",
  // not "Foundation", after typing "found").
  it('queries with the typed filter and lists the returned books', async () => {
    renderModal({}, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      pickerMock('found', [bookEdge('book-2', 'Foundation', 'Isaac Asimov')]),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/filter by title or author/i), {
      target: { value: 'found' },
    });
    await vi.advanceTimersByTimeAsync(200);

    await waitFor(() => expect(screen.getByText('Foundation')).toBeInTheDocument());
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
  });

  // Brief-required: `skip: !isOpen` — no round trip at all while closed.
  it('does not query until the modal is open', async () => {
    const { rerender, client } = renderModal({ isOpen: false }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
    ]);

    // Skipped: the list renders its empty state, never "Loading books…",
    // and the queued mock above is left untouched.
    expect(screen.getByText('No books match.')).toBeInTheDocument();

    // `rerender` only re-wraps in `renderWithProviders`'s OWN `wrapper`
    // (Router/Theme/Toast/Auth) — `ApolloProvider` was applied once, around
    // the FIRST `ui` passed to `renderWithApollo`, so it must be re-supplied
    // explicitly here using the SAME `client` for the new element to still
    // resolve `useQuery`.
    rerender(
      <ApolloProvider client={client}>
        <LinkProgressModal
          isOpen
          documentId={DOCUMENT_ID}
          libraryId={LIBRARY_ID}
          progressId={PROGRESS_ID}
          onClose={vi.fn()}
        />
      </ApolloProvider>
    );

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  });

  // Brief-required: links via bookLinkDocument AND proves the stale orphan
  // Progress entity is evicted from the cache — `useLinkProgress` is the
  // REAL hook here (not mocked), so this exercises its actual `update`
  // callback through the modal's own confirm flow.
  it('links the selected book to the document via bookLinkDocument', async () => {
    const onClose = vi.fn();
    const { client } = renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      linkSuccessMock('book-1'),
    ]);
    seedOrphanProgress(client);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Progress:${PROGRESS_ID}`);
  });

  // Brief-required: a typed union error member surfaces as a message, and
  // the modal stays open (onClose is not called).
  it('surfaces DocumentAlreadyLinkedError as a message and keeps the modal open', async () => {
    const onClose = vi.fn();
    renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      linkAlreadyLinkedMock('book-1'),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() =>
      expect(
        screen.getByText('This document is already linked to another book')
      ).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // `Library.entries` returns the `LibraryEntry` union (`Book | Series`) —
  // `entryType` is deliberately not set on `LinkPickerBooksDocument` (see
  // that document's own doc comment), so this proves the modal itself
  // narrows on `__typename`, discarding `Series` entries client-side.
  it('discards Series entries from the union-typed connection', async () => {
    renderModal({}, [
      pickerMock(undefined, [seriesEdge('series-1'), bookEdge('book-1', 'Dune', 'Frank Herbert')]),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  // Final whole-branch review, "the branch's one unguarded promise":
  // `handleLoadMore`'s original `void fetchMore(...).finally(...)` re-throws
  // a rejection past `void` (`.finally` doesn't swallow it) — a failed
  // "Load more" was an unhandled rejection AND a silent no-op, unlike
  // `MyProgressContent`'s/`UserRowContent`'s own list hooks, which both
  // catch and surface the identical failure. This proves the fix: the
  // failure surfaces as a message, and (implicitly, since vitest fails a
  // test on an unhandled rejection) does not escape as one.
  it('surfaces a failed Load more as a message instead of an unhandled rejection', async () => {
    renderModal({}, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')], {
        hasNextPage: true,
        endCursor: 'book-1',
      }),
      {
        request: {
          query: LinkPickerBooksDocument,
          variables: {
            libraryId: LIBRARY_ID,
            query: undefined,
            after: 'book-1',
          },
        },
        error: new Error('Network error'),
      },
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  // Task 3 review round 1, Item 6: no test exercised a first-page query
  // error at all before this — the empty-message fallback
  // (`error || 'Failed to load books.'`) was silently dropped in the
  // `usePaginatedConnection` migration and nothing caught it. This proves
  // the LIST replaces itself with the error message (the empty-error
  // state, `books.length === 0`), not the "Load more" retry slot below it
  // (that one is exercised by the previous test, which keeps rows).
  it('surfaces a first-page query error as the empty-state message', async () => {
    renderModal({}, [
      {
        request: {
          query: LinkPickerBooksDocument,
          variables: { libraryId: LIBRARY_ID, query: undefined },
        },
        error: new Error('Network error'),
      },
    ]);

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    expect(screen.queryByText('No books match.')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: /dune/i })).not.toBeInTheDocument();
  });

  // The specific regression this item flagged: `error && books.length === 0`
  // (truthy-string check) treats an empty-string error identically to NO
  // error at all and silently falls through to "No books match." instead —
  // `error !== undefined` (matching `page/library`'s own idiom) is what
  // this test guards, with the restored `|| 'Failed to load books.'`
  // fallback covering the empty string itself.
  it('falls back to a generic message when the query error has no text', async () => {
    renderModal({}, [
      {
        request: {
          query: LinkPickerBooksDocument,
          variables: { libraryId: LIBRARY_ID, query: undefined },
        },
        error: new Error(''),
      },
    ]);

    await waitFor(() => expect(screen.getByText('Failed to load books.')).toBeInTheDocument());
  });

  // The four tests below used to be pinned by the now-deleted
  // `use-progress-mutations.test.tsx`'s `describe('useLinkProgress', ...)`
  // block (Task 4 dissolved that hook into this component's own
  // `useMutation(BookLinkDocumentDocument)` call).

  it('sets an error and does not close when the link mutation throws', async () => {
    const onClose = vi.fn();
    renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      linkNetworkErrorMock('book-1'),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  // Re-entrancy guard: TWO protections cooperate here — `handleConfirm`
  // itself returns early (`if (!selectedBookId || linking) return;`) while
  // a previous call is still `linking`, AND the `Link` `Button` is passed
  // `disabled={... || linking}`/`loading={linking}` (`Button` is a `<div
  // role="button">`, not a native `<button>` — its own `handleClick` checks
  // those PROPS, not a DOM `disabled` attribute, so there is nothing to
  // strip off the element to bypass it). With EITHER protection intact, a
  // second click cannot reach a second `runLink` call at all. This test
  // therefore asserts the OBSERVABLE guarantee two rapid clicks give: only
  // ONE `bookLinkDocument` request ever gets sent — pinned by the single
  // queued mock (`MockLink`'s `maxUsageCount` defaults to 1, so a genuine
  // second request throws "No more mocked responses") — AND no error
  // surfaces from a leaked, caught second call. That second assertion is
  // load-bearing: `handleConfirm`'s `catch` swallows a failed second
  // `runLink` into `linkError` state without ever calling `onClose` either
  // way, so `onClose` alone being called exactly once cannot tell "no
  // second request was sent" apart from "a second request was sent, failed,
  // and was silently swallowed" (seen-to-fail: removing BOTH protections —
  // `handleConfirm`'s `|| linking` and the `Link` button's `|| linking`/
  // `loading={linking}` — proved `handleConfirm` fires twice and `onClose`
  // still lands at exactly 1, since the leaked second call's rejection is
  // caught; only the error-text assertion below catches that regression).
  it('does not fire a second mutation while one is in flight', async () => {
    const mock: MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> = {
      request: {
        query: BookLinkDocumentDocument,
        variables: { id: 'book-1', documentId: DOCUMENT_ID },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookLinkDocument: {
            __typename: 'BookLinkDocumentPayload',
            book: { __typename: 'Book', id: 'book-1', lineage: [] },
          },
        },
      },
      delay: 20,
    };

    const onClose = vi.fn();
    renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      mock,
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    const linkButton = screen.getByRole('button', { name: /^link$/i });

    fireEvent.click(linkButton);
    fireEvent.click(linkButton);

    await vi.advanceTimersByTimeAsync(20);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/no more mocked responses/i)).not.toBeInTheDocument();
  });

  // Normalization-suffices claim, pinned directly against the cache (project
  // rule: a claim like this must be asserted, not just left as an absence of
  // hand-written `update` code). `book { id lineage { ... } }` is re-selected
  // in full, so Apollo overwrites the existing `Book:<id>` entity's
  // `lineage` field on its own.
  it('normalizes the returned book.lineage onto the Book entity without a hand-written update', async () => {
    const onClose = vi.fn();
    const { client } = renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
      linkSuccessMock('book-1', [
        {
          __typename: 'LinkedDocument',
          oldId: DOCUMENT_ID,
          newId: 'book-1',
          type: 'EDIT',
        },
      ]),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const extracted = client.cache.extract() as NormalizedCacheObject;
    const bookEntity = extracted['Book:book-1'] as { lineage?: unknown[] } | undefined;
    expect(bookEntity?.lineage).toEqual([
      {
        __typename: 'LinkedDocument',
        oldId: DOCUMENT_ID,
        newId: 'book-1',
        type: 'EDIT',
      },
    ]);
  });

  // I-3 (final whole-branch review, carried from the deleted hook test): not
  // just that the stale orphan row is GONE, but that it REAPPEARS, correctly
  // attached to its book, once the invalidated `Library.progress` connection
  // refetches. `ProbeMyProgressList` mounts a REAL, active
  // `useQuery(MyProgressListDocument)` alongside the modal: the field-level
  // evict makes that watched query's cached data incomplete, which (default
  // `cache-first` fetch policy) drives Apollo to refetch over the network
  // automatically. The refetch mock returns the row under a DIFFERENT
  // `Progress` id (the server re-keys it on link — see this component's own
  // doc comment) WITH `book` attached, so a test that only checked "the old
  // id is gone" could not tell this apart from the row simply staying gone.
  it('re-fetches Library.progress after a link so the row reappears attached to its book', async () => {
    const RELINK_BOOK_ID = 'book-relink-target';
    const RELINKED_PROGRESS_ID = 'progress-relinked';

    const initialFetchMock: MockedResponse<MyProgressListQuery, MyProgressListQueryVariables> = {
      request: {
        query: MyProgressListDocument,
        variables: myProgressListVariables,
      },
      result: {
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: LIBRARY_ID,
            progress: {
              __typename: 'LibraryProgressConnection',
              edges: [
                {
                  __typename: 'LibraryProgressConnectionEdge',
                  cursor: PROGRESS_ID,
                  node: progressRow(),
                },
              ],
              pageInfo: {
                __typename: 'PageInfo',
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        },
      },
    };

    const refetchMock: MockedResponse<MyProgressListQuery, MyProgressListQueryVariables> = {
      request: {
        query: MyProgressListDocument,
        variables: myProgressListVariables,
      },
      result: {
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: LIBRARY_ID,
            progress: {
              __typename: 'LibraryProgressConnection',
              edges: [
                {
                  __typename: 'LibraryProgressConnectionEdge',
                  cursor: RELINKED_PROGRESS_ID,
                  node: progressRow({
                    id: RELINKED_PROGRESS_ID,
                    document: RELINK_BOOK_ID,
                    book: {
                      __typename: 'Book',
                      id: RELINK_BOOK_ID,
                      title: 'Dune',
                      author: 'Frank Herbert',
                      hasCover: true,
                      thumbnailUrl: 'thumb.png',
                    },
                  }),
                },
              ],
              pageInfo: {
                __typename: 'PageInfo',
                hasNextPage: false,
                endCursor: null,
              },
            },
          },
        },
      },
    };

    renderWithApollo(
      <>
        <ProbeMyProgressList />
        <LinkProgressModal
          isOpen
          documentId={DOCUMENT_ID}
          libraryId={LIBRARY_ID}
          progressId={PROGRESS_ID}
          onClose={vi.fn()}
        />
      </>,
      {
        mocks: [
          initialFetchMock,
          pickerMock(undefined, [bookEdge(RELINK_BOOK_ID, 'Dune', 'Frank Herbert')]),
          linkSuccessMock(RELINK_BOOK_ID),
          refetchMock,
        ],
      }
    );

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(PROGRESS_ID));
    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent(RELINKED_PROGRESS_ID)
    );
  });
});
