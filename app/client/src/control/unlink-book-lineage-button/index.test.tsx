import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  BookUnlinkDocumentMutation,
  BookUnlinkDocumentMutationVariables,
} from '~/gql/graphql';
import { BookUnlinkDocumentDocument } from '~/graphql/book';
import { renderWithApollo } from '~/test-utils';

import { UnlinkBookLineageButton } from './index';

const BOOK_ID = 'book-1';
const DOCUMENT_ID = 'doc-old-12345678';

const unlinkOkMock: MockedResponse<
  BookUnlinkDocumentMutation,
  BookUnlinkDocumentMutationVariables
> = {
  request: {
    query: BookUnlinkDocumentDocument,
    variables: { id: BOOK_ID, documentId: DOCUMENT_ID },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookUnlinkDocument: {
        __typename: 'BookUnlinkDocumentPayload',
        book: { __typename: 'Book', id: BOOK_ID, lineage: [] },
      },
    },
  },
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

// The confirm dialog's own "Unlink" button and the trigger button (also
// literally "unlink") both match `/^unlink$/i` once the dialog is open —
// scoped to the dialog to disambiguate.
const getConfirmButton = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: /^unlink$/i });

describe('UnlinkBookLineageButton', () => {
  it('renders the book title from its prop, issuing no book query', async () => {
    // An EMPTY mock list: `useBook` would have fired a REST call. It may not
    // — the title is a prop now, not a lookup.
    renderWithApollo(
      <UnlinkBookLineageButton
        bookId={BOOK_ID}
        bookTitle="A Wizard of Earthsea"
        documentId={DOCUMENT_ID}
      />,
      { mocks: [] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument();
  });

  it('opens a confirm modal showing the truncated document id', async () => {
    renderWithApollo(
      <UnlinkBookLineageButton bookId={BOOK_ID} bookTitle="Dune" documentId={DOCUMENT_ID} />,
      { mocks: [] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(screen.getByText(/doc-…5678/)).toBeInTheDocument();
  });

  it('calls the mutation and onSuccess, then closes the modal, on confirm', async () => {
    const onSuccess = vi.fn();
    renderWithApollo(
      <UnlinkBookLineageButton
        bookId={BOOK_ID}
        bookTitle="Dune"
        documentId={DOCUMENT_ID}
        onSuccess={onSuccess}
      />,
      { mocks: [unlinkOkMock] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(getConfirmButton());

    // `onSuccess` fires BETWEEN two React commits — the handler queues the
    // modal close before calling it and `setUnlinking(false)` after — so
    // sampling the DOM once after the wait resolves is racy. Both assertions
    // retry together instead. (Observed failing under full-suite load.)
    // A closed `<dialog>` (no `open` attribute) is excluded from the
    // accessibility tree by default — its absence here IS the "closed" proof.
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('surfaces the mutation error message and does not call onSuccess', async () => {
    const onSuccess = vi.fn();
    renderWithApollo(
      <UnlinkBookLineageButton
        bookId={BOOK_ID}
        bookTitle="Dune"
        documentId={DOCUMENT_ID}
        onSuccess={onSuccess}
      />,
      {
        mocks: [
          {
            request: {
              query: BookUnlinkDocumentDocument,
              variables: { id: BOOK_ID, documentId: DOCUMENT_ID },
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
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('sets error and does not call onSuccess when the mutation resolves missing', async () => {
    const onSuccess = vi.fn();
    renderWithApollo(
      <UnlinkBookLineageButton
        bookId={BOOK_ID}
        bookTitle="Dune"
        documentId={DOCUMENT_ID}
        onSuccess={onSuccess}
      />,
      {
        mocks: [
          {
            request: {
              query: BookUnlinkDocumentDocument,
              variables: { id: BOOK_ID, documentId: DOCUMENT_ID },
            },
            result: { data: { __typename: 'Mutation' as const, bookUnlinkDocument: null } },
          },
        ],
      }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(getConfirmButton());

    expect(await screen.findByText(/failed to unlink document/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows loading on the confirm button while the mutation is in flight', async () => {
    renderWithApollo(
      <UnlinkBookLineageButton bookId={BOOK_ID} bookTitle="Dune" documentId={DOCUMENT_ID} />,
      { mocks: [{ ...unlinkOkMock, delay: 20 }] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(getConfirmButton());

    // `Button` is a styled `<div role="button">`, not a native `<button>` —
    // its "disabled" state is `aria-disabled`, which jest-dom's `toBeDisabled`
    // does not recognize on a div, so it's asserted directly.
    expect(getConfirmButton()).toHaveAttribute('aria-disabled', 'true');
    await waitFor(() => expect(getConfirmButton()).not.toHaveAttribute('aria-disabled'));
  });

  it('ignores a second confirm click while the first is still in flight', async () => {
    const onSuccess = vi.fn();
    renderWithApollo(
      <UnlinkBookLineageButton
        bookId={BOOK_ID}
        bookTitle="Dune"
        documentId={DOCUMENT_ID}
        onSuccess={onSuccess}
      />,
      { mocks: [{ ...unlinkOkMock, delay: 20 }] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    const confirmButton = getConfirmButton();
    await userEvent.click(confirmButton);
    // A second click while in flight must not consume a second mock —
    // MockLink only has ONE queued response; if the guard were missing, the
    // second call would try to consume a second response from a link with
    // none left.
    await userEvent.click(confirmButton);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('cancels without calling the mutation', async () => {
    renderWithApollo(
      <UnlinkBookLineageButton bookId={BOOK_ID} bookTitle="Dune" documentId={DOCUMENT_ID} />,
      { mocks: [] }
    );

    await userEvent.click(screen.getByRole('button', { name: /unlink/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByText(/doc-…5678/)).not.toBeVisible();
  });
});
