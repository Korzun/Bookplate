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
    useSeriesNames: () => [[], false, undefined],
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
