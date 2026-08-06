import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { makeFragmentData } from '~/gql';
import type { BookRowFragmentFragment } from '~/gql/graphql';
import { BookRowFragment } from '~/graphql/library';
import { apiFetch } from '~/lib/api-fetch';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { BookRowFromEntry } from './from-entry';

const mockApiFetch = vi.mocked(apiFetch);

const makeBookRowData = (
  overrides: Partial<BookRowFragmentFragment> = {}
): BookRowFragmentFragment => ({
  __typename: 'Book',
  id: 'gid-book-1',
  title: 'Dune',
  author: 'Frank Herbert',
  seriesIndex: 1,
  hasCover: true,
  thumbnailUrl: '/api/books/book-1/cover?width=88&v=123',
  progress: { __typename: 'Progress', id: 'progress-1', percentage: 0.5 },
  ...overrides,
});

const makeOkResponse = (blob: Blob) => ({ ok: true, blob: () => Promise.resolve(blob) });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  mockApiFetch.mockReset();
});

describe('BookRowFromEntry', () => {
  it('renders title, author and progress from the fragment without fetching', () => {
    // No `mocks` passed to renderWithApollo: MockLink's "no more mocked
    // responses" error is async (an rxjs Observable error scheduled via
    // `asapScheduler`, not a synchronous throw — verified by reading
    // `mockLink.js` and by experiment), so it alone wouldn't fail a
    // synchronous assertion. What actually makes this test fail loudly if
    // fetching is reintroduced is that `getByText` below reads content this
    // component only has synchronously because it comes straight off the
    // already-unmasked fragment prop — a naive reintroduced query (gating
    // render behind its own `loading`, the realistic regression shape) has
    // NOT resolved on the first render, so the row renders empty and these
    // assertions miss. Seen-to-fail: temporarily added exactly that
    // (`useQuery(LibraryEntriesDocument, ...)` + `if (loading) return null`)
    // to `from-entry.tsx` — this test failed on `getByText('Dune')` finding
    // nothing. Reverted; recorded in task 7's report.
    const book = makeFragmentData(makeBookRowData({ hasCover: false }), BookRowFragment);

    const { getByText } = renderWithApollo(<BookRowFromEntry book={book} />);

    expect(getByText('Dune')).toBeInTheDocument();
    expect(getByText('Frank Herbert · Book 1 · 50%')).toBeInTheDocument();
  });

  it('uses the server-supplied thumbnailUrl for the cover, authorized via useAuthorizedSrc', async () => {
    const blob = new Blob(['cover-bytes'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);
    const book = makeFragmentData(
      makeBookRowData({ thumbnailUrl: '/api/books/book-1/cover?width=88&v=123&user=alice' }),
      BookRowFragment
    );

    const { getByRole } = renderWithApollo(<BookRowFromEntry book={book} />);

    await waitFor(() => {
      expect(getByRole('img')).toHaveAttribute('src', 'blob:test-cover');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book-1/cover?width=88&v=123&user=alice');
  });

  it('renders the placeholder, not an img, when hasCover is false — and never calls apiFetch', () => {
    const book = makeFragmentData(makeBookRowData({ hasCover: false }), BookRowFragment);

    const { queryByRole } = renderWithApollo(<BookRowFromEntry book={book} />);

    expect(queryByRole('img')).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("navigates to the book's global id on click", async () => {
    const user = userEvent.setup();
    const book = makeFragmentData(
      makeBookRowData({ id: 'gid-book-42', hasCover: false }),
      BookRowFragment
    );

    const { getByText } = renderWithApollo(<BookRowFromEntry book={book} />);
    await user.click(getByText('Dune'));

    expect(mocks.navigate).toHaveBeenCalledWith(path.book('gid-book-42'));
  });
});
