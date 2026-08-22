import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BookEditBook } from '~/provider/book';
import { path } from '~/router';
import { renderWithProviders } from '~/test-utils';

import { BookEditForm } from './index';

// Shared, test-controlled state for the mocked hooks/navigation.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  nextResult: { mode: 'ok' as 'ok' | 'fail-cover' | 'fail-save' },
  fetchSeriesNextIndex: vi.fn((name: string) => Promise.resolve(name === 'Dune' ? 4 : 1)),
  updateBookMetadata: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

// A stateful fake of `useUpdateBookMetadata`: calling the update fn flips its
// internal error state exactly like the real hook (a 3-tuple — see the
// hook's own doc comment on why it isn't a 4-tuple like its four siblings),
// so the component's error-handling (toast + navigation guard) runs against
// a real state transition rather than a frozen tuple. `mocks.updateBookMetadata`
// records every call's arguments so tests can assert on the exact patch sent.
vi.mock('~/provider/book', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/book')>();
  const { useState, useCallback } = await import('react');
  return {
    ...actual,
    useLibrarySubjects: () => [[], false, undefined],
    useSeriesNames: () => [['Dune'], false, undefined],
    useFetchSeriesNextIndex: () => mocks.fetchSeriesNextIndex,
    useUpdateBookMetadata: () => {
      const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
      const update = useCallback(async (bookId: string, patch: unknown) => {
        mocks.updateBookMetadata(bookId, patch);
        if (mocks.nextResult.mode === 'fail-cover') {
          setErrorMessage("Couldn't upload the cover image");
          return undefined;
        }
        if (mocks.nextResult.mode === 'fail-save') {
          setErrorMessage("Couldn't save your changes");
          return undefined;
        }
        setErrorMessage(undefined);
        // Deliberately DIFFERENT literal values (same convention the
        // Cancel-navigation test below uses) so a test asserting on
        // `path.book(...)` can't pass by coincidence if Save regresses to
        // navigating with `documentId` (the RAW hash) instead of the
        // payload's global `id`.
        return { id: 'new-global-id', documentId: 'new-document-id' };
      }, []);
      return [update, false, errorMessage];
    },
  };
});

const book: BookEditBook = {
  id: 'book-1',
  documentId: 'raw-hash-book-1',
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
  validation: { id: 'book-1', valid: true },
};

afterEach(() => {
  mocks.navigate.mockClear();
  mocks.nextResult.mode = 'ok';
  mocks.fetchSeriesNextIndex.mockClear();
  mocks.updateBookMetadata.mockClear();
});

describe('BookEditForm', () => {
  // `book.id` IS the Relay global id (`graphql/book-edit.ts`'s
  // `BookEditDocument`), so Save's post-write navigation uses the mutation
  // PAYLOAD's `id` directly — no separate `.globalId` field exists anymore
  // in the GraphQL shape (that was REST-only). The mock above returns
  // visibly different `id`/`documentId` literals so this can't pass by
  // coincidence.
  it('navigates to the book using the mutation payload id, not its documentId', async () => {
    mocks.nextResult.mode = 'ok';
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={book} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(path.book('new-global-id')));
    expect(mocks.navigate).not.toHaveBeenCalledWith(path.book('new-document-id'));
  });

  it('stays on the form and shows a save-specific message when the mutation errors', async () => {
    mocks.nextResult.mode = 'fail-save';
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={book} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText("Couldn't save your changes")).toBeInTheDocument());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('stays on the form and shows a cover-specific message when staging the cover fails', async () => {
    mocks.nextResult.mode = 'fail-cover';
    const { container } = renderWithProviders(<BookEditForm book={book} />);
    const user = userEvent.setup();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText("Couldn't upload the cover image")).toBeInTheDocument()
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('stages the cover then saves, navigating with the payload id', async () => {
    mocks.nextResult.mode = 'ok';
    const { container } = renderWithProviders(<BookEditForm book={book} />);
    const user = userEvent.setup();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(path.book('new-global-id')));
    expect(mocks.updateBookMetadata).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ cover: file })
    );
  });

  // `book.id` — the GraphQL book's own id field, already a Relay GLOBAL id
  // (`graphql/book-edit.ts`) — is what Cancel navigates with now that the
  // form's prop IS the GraphQL book; the old `bookGlobalId` prop (a second
  // path to the same value) is gone.
  it('cancels back to the book using the global id', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={book} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.navigate).toHaveBeenCalledWith(path.book('book-1'));
  });

  // The partial-patch semantic: only a field that actually changed should
  // ride in the mutation's input. Changing ONLY the title must leave every
  // other diffable field `undefined` in the sent patch — asserted per-field
  // rather than via `toEqual` so a future field addition doesn't silently
  // widen this test's meaning.
  it('sends only the fields that actually changed', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<BookEditForm book={book} />);

    const titleInput = container.querySelector('input[name="title"]') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.updateBookMetadata).toHaveBeenCalled());
    const [, sentPatch] = mocks.updateBookMetadata.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];

    expect(sentPatch.title).toBe('New Title');
    expect(sentPatch.author).toBeUndefined();
    expect(sentPatch.titleSort).toBeUndefined();
    expect(sentPatch.authorSort).toBeUndefined();
    expect(sentPatch.publisher).toBeUndefined();
    expect(sentPatch.publishDate).toBeUndefined();
    expect(sentPatch.series).toBeUndefined();
    expect(sentPatch.seriesIndex).toBeUndefined();
    expect(sentPatch.description).toBeUndefined();
    expect(sentPatch.subjects).toBeUndefined();
    expect(sentPatch.identifiers).toBeUndefined();
    expect(sentPatch.cover).toBeUndefined();
  });

  // The cards are spaced by Page's flex column gap. If the wrapping <form> ever
  // generates a box it swallows them into a single flex item and every gap
  // between the cards disappears, so it has to stay `display: contents`.
  it('keeps the form boxless so the cards stay spaced by the page', () => {
    const { container } = renderWithProviders(<BookEditForm book={book} />);
    const form = container.querySelector('form') as HTMLElement;
    expect(form.querySelectorAll(':scope > *').length).toBeGreaterThan(1);
    expect(getComputedStyle(form).display).toBe('contents');
  });
});

describe('series order auto-fill', () => {
  const seriesInput = () => document.querySelector('input[name="seriesIndex"]') as HTMLInputElement;

  async function openSeriesAndPick(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), name);
    await user.keyboard('{Enter}');
  }

  it('fills empty Order with the fetched next index for an existing series', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={{ ...book, series: null, seriesIndex: 0 }} />);
    await openSeriesAndPick(user, 'Dune');
    await waitFor(() => expect(seriesInput().value).toBe('4'));
    expect(mocks.fetchSeriesNextIndex).toHaveBeenCalledWith('Dune');
  });

  it('fills Order with 1 for a brand-new series', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={{ ...book, series: null, seriesIndex: 0 }} />);
    await openSeriesAndPick(user, 'Brand New');
    await waitFor(() => expect(seriesInput().value).toBe('1'));
  });

  it('does not overwrite an Order the user already entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={{ ...book, series: null, seriesIndex: 0 }} />);
    await user.click(screen.getByRole('switch', { name: 'isSeries' }));
    await user.type(seriesInput(), '2');
    await user.click(screen.getByRole('button', { name: 'Select…' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Dune');
    await user.keyboard('{Enter}');
    expect(mocks.fetchSeriesNextIndex).not.toHaveBeenCalled();
    expect(seriesInput().value).toBe('2');
  });

  it('does not overwrite an Order typed while the next-index fetch is still in flight', async () => {
    let resolveNext: (value: number) => void = () => {};
    mocks.fetchSeriesNextIndex.mockImplementationOnce(
      () =>
        new Promise<number>((res) => {
          resolveNext = res;
        })
    );

    const user = userEvent.setup();
    renderWithProviders(<BookEditForm book={{ ...book, series: null, seriesIndex: 0 }} />);
    await openSeriesAndPick(user, 'Dune');

    // The fetch is still pending here; type an Order before it resolves.
    await user.type(seriesInput(), '2');

    resolveNext(4);
    await waitFor(() => expect(mocks.fetchSeriesNextIndex).toHaveBeenCalledWith('Dune'));
    expect(seriesInput().value).toBe('2');
  });
});
