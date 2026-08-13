import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { makeFragmentData } from '~/gql';
import type { SeriesBookRowFragmentFragment } from '~/gql/graphql';
import { SeriesBookRowFragment } from '~/graphql/series';
import { apiFetch } from '~/lib/api-fetch';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { BookRowFromSeriesBook } from './from-series-book';

const mockApiFetch = vi.mocked(apiFetch);

const makeSeriesBookRowData = (
  overrides: Partial<SeriesBookRowFragmentFragment> = {}
): SeriesBookRowFragmentFragment => ({
  __typename: 'Book',
  id: 'gid-book-1',
  title: 'A Wizard of Earthsea',
  seriesIndex: 1,
  hasCover: true,
  thumbnailUrl: '/api/books/1/cover?width=88&user=le&v=1',
  progress: { __typename: 'Progress', id: 'gid-progress-1', percentage: 0.5 },
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

describe('BookRowFromSeriesBook', () => {
  it('renders title, series index and progress from the fragment', () => {
    const book = makeFragmentData(
      makeSeriesBookRowData({ hasCover: false }),
      SeriesBookRowFragment
    );

    renderWithApollo(<BookRowFromSeriesBook book={book} showAuthor={false} />);

    expect(screen.getByText('A Wizard of Earthsea')).toBeInTheDocument();
    expect(screen.getByText(/Book 1/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it('shows no progress text when the book has none', () => {
    const book = makeFragmentData(
      makeSeriesBookRowData({ hasCover: false, progress: null }),
      SeriesBookRowFragment
    );

    renderWithApollo(<BookRowFromSeriesBook book={book} showAuthor={false} />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('uses the server-supplied thumbnailUrl for the cover, authorized via useAuthorizedSrc', async () => {
    const blob = new Blob(['cover-bytes'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);
    const book = makeFragmentData(
      makeSeriesBookRowData({ thumbnailUrl: '/api/books/1/cover?width=88&user=alice&v=1' }),
      SeriesBookRowFragment
    );

    const { getByRole } = renderWithApollo(<BookRowFromSeriesBook book={book} />);

    await waitFor(() => {
      expect(getByRole('img')).toHaveAttribute('src', 'blob:test-cover');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/1/cover?width=88&user=alice&v=1');
  });

  it("navigates to the book's global id on click", async () => {
    const user = userEvent.setup();
    const book = makeFragmentData(
      makeSeriesBookRowData({ id: 'gid-book-42', hasCover: false }),
      SeriesBookRowFragment
    );

    const { getByText } = renderWithApollo(<BookRowFromSeriesBook book={book} />);
    await user.click(getByText('A Wizard of Earthsea'));

    expect(mocks.navigate).toHaveBeenCalledWith(path.book('gid-book-42'));
  });
});
