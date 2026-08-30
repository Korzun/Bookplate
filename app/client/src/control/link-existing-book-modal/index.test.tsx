import { ApolloProvider } from '@apollo/client/react';
import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkPickerBooksQuery, LinkPickerBooksQueryVariables } from '~/gql/graphql';
import { LinkPickerBooksDocument } from '~/graphql/progress';
import { renderWithApollo } from '~/test-utils';

import { LinkExistingBookModal } from './index';

const LIBRARY_ID = 'TGliOmJvYg==';

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

/** See `link-progress-modal/index.test.tsx`'s identical `pickerMock` doc
 * comment for why `after` is omitted, not passed as `undefined`, on the
 * initial fetch. */
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

const renderModal = (
  props: Partial<ComponentProps<typeof LinkExistingBookModal>> = {},
  mocks: MockedResponse[] = []
) =>
  renderWithApollo(
    <LinkExistingBookModal
      isOpen
      libraryId={LIBRARY_ID}
      onPick={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
    { mocks }
  );

describe('LinkExistingBookModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the named library’s books', async () => {
    renderModal({}, [pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')])]);
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('Frank Herbert')).toBeInTheDocument();
  });

  it('does not query until open', async () => {
    const { rerender, client } = renderModal({ isOpen: false }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
    ]);

    expect(screen.getByText('No books match.')).toBeInTheDocument();

    // `rerender` only re-wraps in `renderWithProviders`'s own wrapper —
    // `ApolloProvider` must be re-supplied explicitly (same note as
    // `link-progress-modal/index.test.tsx`'s identical case).
    rerender(
      <ApolloProvider client={client}>
        <LinkExistingBookModal isOpen libraryId={LIBRARY_ID} onPick={vi.fn()} onClose={vi.fn()} />
      </ApolloProvider>
    );

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
  });

  it('queries with the typed, debounced filter', async () => {
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

  // The one structural difference from `LinkProgressModal`: no separate
  // "select, then confirm" step — `onPick` fires the instant a book is
  // clicked, since this modal owns no mutation of its own (the caller does).
  it('calls onPick immediately on click, with no confirm step', async () => {
    const onPick = vi.fn();
    renderModal({ onPick }, [pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')])]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /dune/i }));

    expect(onPick).toHaveBeenCalledWith('book-1');
    expect(screen.queryByRole('button', { name: /^link$/i })).not.toBeInTheDocument();
  });

  it('discards Series entries from the union-typed connection', async () => {
    renderModal({}, [
      pickerMock(undefined, [seriesEdge('series-1'), bookEdge('book-1', 'Dune', 'Frank Herbert')]),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows an empty state when nothing matches', async () => {
    renderModal({}, [pickerMock(undefined, [])]);
    await waitFor(() => expect(screen.getByText('No books match.')).toBeInTheDocument());
  });

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
  });

  it('calls onClose from Cancel', async () => {
    const onClose = vi.fn();
    renderModal({ onClose }, [
      pickerMock(undefined, [bookEdge('book-1', 'Dune', 'Frank Herbert')]),
    ]);

    await waitFor(() => expect(screen.getByText('Dune')).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
