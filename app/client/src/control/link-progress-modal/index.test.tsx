import type { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BookLinkDocumentMutation,
  BookLinkDocumentMutationVariables,
  LinkPickerBooksQuery,
  LinkPickerBooksQueryVariables,
} from '~/gql/graphql';
import {
  BookLinkDocumentDocument,
  LinkPickerBooksDocument,
  ProgressRowFragment,
} from '~/graphql/progress';
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
  bookId: string
): MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> => ({
  request: { query: BookLinkDocumentDocument, variables: { id: bookId, documentId: DOCUMENT_ID } },
  result: {
    data: {
      __typename: 'Mutation',
      bookLinkDocument: {
        __typename: 'BookLinkDocumentPayload',
        book: { __typename: 'Book', id: bookId, lineage: [] },
      },
    },
  },
});

const linkAlreadyLinkedMock = (
  bookId: string
): MockedResponse<BookLinkDocumentMutation, BookLinkDocumentMutationVariables> => ({
  request: { query: BookLinkDocumentDocument, variables: { id: bookId, documentId: DOCUMENT_ID } },
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
          variables: { libraryId: LIBRARY_ID, query: undefined, after: 'book-1' },
        },
        error: new Error('Network error'),
      },
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
