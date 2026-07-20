import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Book } from '~/provider/book';
import { path } from '~/router';
import { renderWithProviders } from '~/test-utils';

import { BookEditForm } from './index';

// Shared, test-controlled state for the mocked hooks/navigation.
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  nextResult: { mode: 'ok' as 'ok' | 'fail', failMessage: 'Edited EPUB failed validation' },
  fetchSeriesNextIndex: vi.fn((name: string) => Promise.resolve(name === 'Dune' ? 4 : 1)),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

// A stateful fake of usePatchBookMetadata: calling the patch fn flips its
// internal error state exactly like the real hook, so the component's
// error-handling (toast + navigation guard) runs against a real state
// transition rather than a frozen tuple.
vi.mock('~/provider/book', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/book')>();
  const { useState, useCallback } = await import('react');
  return {
    ...actual,
    useLibrarySubjects: () => [[], false, undefined],
    useSeriesNames: () => [['Dune'], false, undefined],
    useFetchSeriesNextIndex: () => mocks.fetchSeriesNextIndex,
    usePatchBookMetadata: () => {
      const [state, setState] = useState<{ error: boolean; message?: string }>({ error: false });
      const patch = useCallback(async () => {
        if (mocks.nextResult.mode === 'fail') {
          setState({ error: true, message: mocks.nextResult.failMessage });
          return undefined;
        }
        setState({ error: false, message: undefined });
        return 'new-id';
      }, []);
      return [patch, false, state.error, state.message];
    },
  };
});

const original: Book = {
  id: 'book-1',
  title: 'Original Title',
  author: 'Original Author',
  titleSort: '',
  authorSort: '',
  publishDate: '',
  series: '',
  seriesIndex: 0,
  description: '',
  subjects: [],
  identifiers: [],
  hasCover: false,
  size: 0,
  chapterCount: 0,
  pageCount: 0,
};

afterEach(() => {
  mocks.navigate.mockClear();
  mocks.nextResult.mode = 'ok';
  mocks.fetchSeriesNextIndex.mockClear();
});

describe('BookEditForm', () => {
  it('navigates to the book after a successful save', async () => {
    mocks.nextResult.mode = 'ok';
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm original={original} id="book-1" />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(path.book('new-id')));
  });

  it('shows an error toast and does not navigate away when the save fails', async () => {
    mocks.nextResult.mode = 'fail';
    const user = userEvent.setup();
    renderWithProviders(<BookEditForm original={original} id="book-1" />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText('Edited EPUB failed validation')).toBeInTheDocument()
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
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
    renderWithProviders(
      <BookEditForm original={{ ...original, series: '', seriesIndex: 0 }} id="book-1" />
    );
    await openSeriesAndPick(user, 'Dune');
    await waitFor(() => expect(seriesInput().value).toBe('4'));
    expect(mocks.fetchSeriesNextIndex).toHaveBeenCalledWith('Dune');
  });

  it('fills Order with 1 for a brand-new series', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookEditForm original={{ ...original, series: '', seriesIndex: 0 }} id="book-1" />
    );
    await openSeriesAndPick(user, 'Brand New');
    await waitFor(() => expect(seriesInput().value).toBe('1'));
  });

  it('does not overwrite an Order the user already entered', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookEditForm original={{ ...original, series: '', seriesIndex: 0 }} id="book-1" />
    );
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
    renderWithProviders(
      <BookEditForm original={{ ...original, series: '', seriesIndex: 0 }} id="book-1" />
    );
    await openSeriesAndPick(user, 'Dune');

    // The fetch is still pending here; type an Order before it resolves.
    await user.type(seriesInput(), '2');

    resolveNext(4);
    await waitFor(() => expect(mocks.fetchSeriesNextIndex).toHaveBeenCalledWith('Dune'));
    expect(seriesInput().value).toBe('2');
  });
});
