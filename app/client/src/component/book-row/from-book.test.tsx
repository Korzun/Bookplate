import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');
vi.mock('~/provider/library-target');
vi.mock('~/provider/progress');

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { apiFetch } from '~/lib/api-fetch';
import type { Book } from '~/provider/book';
import { useWithTargetUser, type WithTargetUser } from '~/provider/library-target';
import { useMyProgress } from '~/provider/progress';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { BookRowFromBook } from './from-book';

const mockApiFetch = vi.mocked(apiFetch);
const mockUseWithTargetUser = vi.mocked(useWithTargetUser);
const mockUseMyProgress = vi.mocked(useMyProgress);

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Dune',
  author: 'Frank Herbert',
  titleSort: 'Dune',
  authorSort: 'Herbert, Frank',
  publishDate: '1965-01-01',
  series: '',
  seriesIndex: 0,
  subjects: [],
  identifiers: [],
  hasCover: true,
  size: 100,
  chapterCount: 1,
  pageCount: 1,
  mtime: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

// Mirrors production's identity for a non-admin: URLs pass through unchanged.
const identityWithTargetUser = ((url: string) => url) as WithTargetUser;
identityWithTargetUser.ready = true;
identityWithTargetUser.username = undefined;

const makeOkResponse = (blob: Blob) => ({ ok: true, blob: () => Promise.resolve(blob) });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  mockUseWithTargetUser.mockReturnValue(identityWithTargetUser);
  mockUseMyProgress.mockReturnValue([undefined, false, false, undefined]);
});

afterEach(() => {
  mockApiFetch.mockReset();
  vi.clearAllMocks();
});

describe('BookRowFromBook', () => {
  it('renders title, author and progress from the Book it is given, without fetching the book itself', () => {
    // No `mocks` passed to renderWithApollo, no `useBook` mock, no
    // BookProvider in the tree: if this component re-fetched by id (the
    // pre-task-7 shape) instead of rendering the `Book` its caller already
    // holds, `useBook`'s `use(Context)` would throw immediately (no
    // provider) rather than let this pass vacuously. `getByText` below also
    // only finds real content because it's synchronous prop data — the same
    // "gate render behind a query's loading" seen-to-fail demonstrated on
    // `BookRowFromEntry` (task 7's report) applies here too, just via a
    // context-missing crash instead of an empty render.
    mockUseMyProgress.mockReturnValue([
      { document: 'book-1', percentage: 0.75, device: 'Kindle', timestamp: 0 },
      false,
      false,
      undefined,
    ]);
    const book = makeBook({ seriesIndex: 2, hasCover: false });

    const { getByText } = renderWithApollo(<BookRowFromBook book={book} />);

    expect(getByText('Dune')).toBeInTheDocument();
    expect(getByText('Frank Herbert · Book 2 · 75%')).toBeInTheDocument();
  });

  it('authorizes the coverUrl(book.id, { width: 88 }) thumbnail through withTargetUser', async () => {
    const blob = new Blob(['cover-bytes'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);
    const adminWithTargetUser = ((url: string) => `${url}&user=alice`) as WithTargetUser;
    adminWithTargetUser.ready = true;
    adminWithTargetUser.username = 'alice';
    mockUseWithTargetUser.mockReturnValue(adminWithTargetUser);
    const book = makeBook({ id: 'book-2', mtime: '1970-01-01T00:00:01.000Z' });

    const { getByRole } = renderWithApollo(<BookRowFromBook book={book} />);

    await waitFor(() => {
      expect(getByRole('img')).toHaveAttribute('src', 'blob:test-cover');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book-2/cover?width=88&v=1000&user=alice');
  });

  it('renders the placeholder, not an img, when hasCover is false — and never calls apiFetch', () => {
    const book = makeBook({ hasCover: false });

    const { queryByRole } = renderWithApollo(<BookRowFromBook book={book} />);

    expect(queryByRole('img')).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("navigates to the book's REST id on click, unlike BookRowFromEntry's global id", async () => {
    const user = userEvent.setup();
    const book = makeBook({ id: 'book-42', hasCover: false });

    const { getByText } = renderWithApollo(<BookRowFromBook book={book} />);
    await user.click(getByText('Dune'));

    expect(mocks.navigate).toHaveBeenCalledWith(path.book('book-42'));
  });
});
