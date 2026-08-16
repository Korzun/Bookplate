import { useQuery } from '@apollo/client/react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeFragmentData, type FragmentType } from '~/gql';
import type { LineageEntryFragmentFragment } from '~/gql/graphql';
import {
  BookDetailDocument,
  BookUnlinkDocumentDocument,
  LineageEntryFragment,
} from '~/graphql/book';
import { renderWithApollo } from '~/test-utils';

import { BookLineageModal } from './index';

const BOOK_ID = 'book-1';
const LIBRARY_ID = 'library-1';
const noop = () => {};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

// The `ConfirmModal`'s own `<dialog>` nests INSIDE `BookLineageModal`'s
// `<dialog>` (no portal) — once both are open, `getByRole('dialog')` finds
// two. The inner (confirm) one is always the LAST in DOM order.
const getConfirmButton = () => {
  const dialogs = screen.getAllByRole('dialog');
  return within(dialogs[dialogs.length - 1]).getByRole('button', { name: /^unlink$/i });
};

const rawEntry = (
  overrides: Partial<LineageEntryFragmentFragment> = {}
): LineageEntryFragmentFragment => ({
  __typename: 'LinkedDocument',
  oldId: 'doc-old',
  newId: 'doc-current',
  timestamp: '2026-06-01T00:00:00.000Z',
  type: 'EDIT',
  ...overrides,
});

const fragmentEntry = (
  overrides: Partial<LineageEntryFragmentFragment> = {}
): FragmentType<typeof LineageEntryFragment> =>
  makeFragmentData(rawEntry(overrides), LineageEntryFragment);

const mergeEntry = rawEntry({ oldId: 'doc-merged', newId: 'doc-current', type: 'MERGE' });

describe('BookLineageModal', () => {
  it('explains what book lineage is', () => {
    renderWithApollo(
      <BookLineageModal isOpen bookId={BOOK_ID} bookTitle="Dune" lineage={[]} onClose={noop} />
    );
    expect(screen.getByText(/Lineage maps former IDs to this book/i)).toBeInTheDocument();
  });

  it('groups edit rows and nests merge rows under their parent', () => {
    const lineage = [
      fragmentEntry({
        oldId: 'doc-old',
        newId: 'doc-current',
        timestamp: '2026-06-01T00:00:00.000Z',
        type: 'EDIT',
      }),
      fragmentEntry({
        oldId: 'doc-merged',
        newId: 'doc-current',
        timestamp: '2026-05-01T00:00:00.000Z',
        type: 'MERGE',
      }),
    ];

    renderWithApollo(
      <BookLineageModal
        isOpen
        bookId={BOOK_ID}
        bookTitle="Dune"
        addedAt={500}
        lineage={lineage}
        onClose={noop}
      />
    );

    // The current row's document id is derived from the newest entry's
    // `newId`, not the raw `bookId` prop (lineage is non-empty here).
    expect(screen.getByText('doc-current')).toBeInTheDocument();
    // The edit entry becomes its own row (the book's PREVIOUS id).
    expect(screen.getByText('doc-old')).toBeInTheDocument();
    // The merge entry nests under the row sharing its `newId` (the current row).
    expect(screen.getByText('doc-merged')).toBeInTheDocument();
  });

  it("derives the current row's document id from the newest entry's newId, ignoring bookId", () => {
    const lineage = [fragmentEntry({ oldId: 'doc-old', newId: 'doc-new-current', type: 'EDIT' })];

    renderWithApollo(
      <BookLineageModal
        isOpen
        bookId="Qm9vazox"
        bookTitle="Dune"
        lineage={lineage}
        onClose={noop}
      />
    );

    expect(screen.getByText('doc-new-current')).toBeInTheDocument();
    expect(screen.queryByText('Qm9vazox')).not.toBeInTheDocument();
  });

  /**
   * THE part most likely to go wrong (task brief). REST's `getBookLineage`
   * (`app/server/services/book-store.ts:552`, `return { currentId: id,
   * entries }`) always echoed back the exact `id` it was called with as
   * `currentId` — regardless of whether `entries` was empty — and that `id`
   * was the same `bookId` the REST hook (`use-book-lineage.ts`) was given.
   * GraphQL's `Book` type exposes no raw id at all (by design — see
   * `graphql/book.ts`'s `LineageEntryFragment` doc comment on "the client
   * never holds a raw book id"), so when `lineage` is empty there is no raw
   * hash anywhere in this component's data to derive one from. Falling back
   * to the `bookId` prop reproduces REST's rendered string byte-for-byte, as
   * long as `bookId` itself is still a raw hash — true today, since
   * `page/book` still sources it from the REST `useBook` hook (see this
   * task's report for the caveat once `page/book` moves to `useBookDetail`).
   */
  it('falls back to the bookId prop for the current row when lineage is empty', () => {
    renderWithApollo(
      <BookLineageModal
        isOpen
        bookId="raw-hash-abc123"
        bookTitle="Dune"
        addedAt={500}
        lineage={[]}
        onClose={noop}
      />
    );

    expect(screen.getByText('raw-hash-abc123')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    renderWithApollo(
      <BookLineageModal isOpen bookId={BOOK_ID} bookTitle="Dune" lineage={[]} onClose={onClose} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the dialog backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = renderWithApollo(
      <BookLineageModal isOpen bookId={BOOK_ID} bookTitle="Dune" lineage={[]} onClose={onClose} />
    );
    const dialogEl = container.querySelector('dialog');
    expect(dialogEl).not.toBeNull();
    fireEvent.click(dialogEl as HTMLDialogElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the book title from its prop, issuing no book query', async () => {
    // An EMPTY mock list: `useBook` would have fired a REST call and
    // `useBookDetail` a GraphQL one. Neither may happen — the title is a
    // prop, and unlinking the merge row needs it for its confirm text.
    renderWithApollo(
      <BookLineageModal
        isOpen
        bookId={BOOK_ID}
        bookTitle="A Wizard of Earthsea"
        lineage={[fragmentEntry(mergeEntry)]}
        onClose={noop}
      />,
      { mocks: [] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument();
  });

  it('surfaces EditLineageEntryError as an error message', async () => {
    renderWithApollo(
      <BookLineageModal
        isOpen
        bookId={BOOK_ID}
        bookTitle="A Wizard of Earthsea"
        lineage={[fragmentEntry(mergeEntry)]}
        onClose={noop}
      />,
      {
        mocks: [
          {
            request: {
              query: BookUnlinkDocumentDocument,
              variables: { id: BOOK_ID, documentId: mergeEntry.oldId },
            },
            result: {
              data: {
                __typename: 'Mutation' as const,
                bookUnlinkDocument: {
                  __typename: 'EditLineageEntryError' as const,
                  message: 'Cannot unlink an edit-history entry',
                },
              },
            },
          },
        ],
      }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(getConfirmButton());

    expect(await screen.findByText(/cannot unlink an edit-history entry/i)).toBeInTheDocument();
    // The row survives a refused unlink.
    expect(screen.getByText(mergeEntry.oldId)).toBeInTheDocument();
  });

  /**
   * `bookUnlinkDocument`'s payload re-selects the FULL `lineage` list
   * (`graphql/book.ts`), so Apollo's own normalization overwrites the array
   * on the `Book` entity — the modal itself never calls `refetch` (it has
   * none; it doesn't fetch at all). Proved here with a harness that reads
   * `Book.lineage` through a LIVE `useQuery(BookDetailDocument, {
   * fetchPolicy: 'cache-only' })` (seeded directly via `client.cache.
   * writeQuery`, not a network mock) and re-renders the modal with whatever
   * that query returns — exactly the shape a future `useBookDetail` consumer
   * will have. `mocks` carries exactly ONE entry, for the mutation alone —
   * NOT because a stray refetch would otherwise starve `MockLink` (the
   * harness's `cache-only` policy never touches the link regardless, and the
   * modal has no fetch machinery left to attempt one either way), but
   * because that's all this test needs: the load-bearing claim is that the
   * mutation's re-selected `lineage` normalizes onto the SAME `Book:<id>`
   * entity `BookDetailDocument` reads through, and that change propagates to
   * a live `cache-only` reader with no explicit refetch call anywhere in
   * this path.
   */
  it('removes an unlinked merge row without a refetch', async () => {
    function Harness() {
      const { data } = useQuery(BookDetailDocument, {
        variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
        fetchPolicy: 'cache-only',
      });
      const node = data?.node;
      const book = node?.__typename === 'Library' ? node.book : undefined;
      return (
        <BookLineageModal
          isOpen
          bookId={BOOK_ID}
          bookTitle="A Wizard of Earthsea"
          lineage={book?.lineage ?? []}
          onClose={noop}
        />
      );
    }

    const { client } = renderWithApollo(<Harness />, {
      mocks: [
        {
          request: {
            query: BookUnlinkDocumentDocument,
            variables: { id: BOOK_ID, documentId: mergeEntry.oldId },
          },
          result: {
            data: {
              __typename: 'Mutation' as const,
              bookUnlinkDocument: {
                __typename: 'BookUnlinkDocumentPayload' as const,
                book: { __typename: 'Book' as const, id: BOOK_ID, lineage: [] },
              },
            },
          },
        },
      ],
    });

    act(() => {
      client.cache.writeQuery({
        query: BookDetailDocument,
        variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
        data: {
          __typename: 'Query',
          node: {
            __typename: 'Library',
            id: LIBRARY_ID,
            book: {
              __typename: 'Book',
              id: BOOK_ID,
              title: 'A Wizard of Earthsea',
              author: 'Le Guin',
              description: '',
              publisher: '',
              publishDate: '',
              addedAt: '2026-01-01T00:00:00.000Z',
              mtime: '2026-01-01T00:00:00.000Z',
              size: 0,
              pageCount: 0,
              chapterCount: 0,
              chapterNames: null,
              chapterSpineMap: [],
              subjects: [],
              seriesIndex: 0,
              hasCover: false,
              coverUrl: '',
              deviceEditionCount: 0,
              series: null,
              progress: null,
              validation: null,
              lineage: [rawEntry(mergeEntry)],
              pendingFix: null,
            },
          },
        },
      });
    });

    expect(await screen.findByText('doc-merged')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(getConfirmButton());

    await vi.waitFor(() => expect(screen.queryByText('doc-merged')).not.toBeInTheDocument());
  });
});
