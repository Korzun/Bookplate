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
import type { SeriesRowFragmentFragment } from '~/gql/graphql';
import { SeriesRowFragment } from '~/graphql/library';
import { apiFetch } from '~/lib/api-fetch';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { SeriesRow } from './index';

const mockApiFetch = vi.mocked(apiFetch);

const makeCoverNode = (
  overrides: Partial<{ id: string; title: string; hasCover: boolean }> = {}
) => ({
  __typename: 'Book' as const,
  id: overrides.id ?? 'gid-book-1',
  title: overrides.title ?? 'Book One',
  hasCover: overrides.hasCover ?? true,
  mtime: '2024-01-01T00:00:00.000Z',
  thumbnailUrl: `/api/books/${overrides.id ?? 'gid-book-1'}/cover?width=88`,
});

const makeSeriesRowData = (
  overrides: Partial<SeriesRowFragmentFragment> = {}
): SeriesRowFragmentFragment => ({
  __typename: 'Series',
  id: 'gid-series-1',
  name: 'Dune Chronicles',
  author: 'Frank Herbert',
  bookCount: 6,
  progressPercentage: null,
  books: {
    __typename: 'SeriesBooksConnection',
    edges: [{ __typename: 'SeriesBooksConnectionEdge', node: makeCoverNode() }],
  },
  ...overrides,
});

const makeOkResponse = (blob: Blob) => ({ ok: true, blob: () => Promise.resolve(blob) });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  // Never resolves by default — most of these tests don't assert on the
  // cover image, and a resolution that lands after the test's own
  // assertions (and possible unmount) trips React's `act()` warning for no
  // reason. The two tests that DO care about the cover override this.
  mockApiFetch.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  mockApiFetch.mockReset();
});

describe('SeriesRow', () => {
  it('renders name, author and book count from the fragment without fetching', () => {
    // No `mocks` passed to renderWithApollo: the parent already has every
    // field rendered here, so `getByText` below only finds real content
    // because it's synchronous prop data — the same "gate render behind a
    // query's loading" seen-to-fail demonstrated on `BookRowFromEntry`
    // (task 7's report) would break this the same way.
    const series = makeFragmentData(makeSeriesRowData(), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Dune Chronicles')).toBeInTheDocument();
    expect(getByText('Frank Herbert · 6 book series')).toBeInTheDocument();
  });

  /**
   * Seen-to-fail before this fix: `CoverStack` used to take a bare
   * `seriesName` and filter it against `useSeriesBookList`'s REST list — a
   * list that, in this test harness (no `BookProvider`, matching real usage
   * once `page/library` moved to GraphQL pagination and nothing grew that
   * REST list past page 1), never resolves any books at all. The old
   * version of this test asserted only that `CoverStack` *received*
   * `seriesName` — it mocked `CoverStack` out entirely, so it could not see
   * that the component behind it was ghost-only for any series not on REST
   * page 1. This version renders `CoverStack` for real: a fragment carrying
   * a book WITH a cover must produce a real `<img>`, not a ghost div.
   */
  it('renders a real cover image from the fragment’s own books(first: 3), not a REST fetch', async () => {
    mockApiFetch.mockResolvedValue(
      makeOkResponse(new Blob(['img'], { type: 'image/jpeg' })) as Response
    );
    const series = makeFragmentData(
      makeSeriesRowData({
        name: 'A Series Past Grid Entry 20',
        books: {
          __typename: 'SeriesBooksConnection',
          edges: [
            {
              __typename: 'SeriesBooksConnectionEdge',
              node: makeCoverNode({ id: 'gid-book-21' }),
            },
          ],
        },
      }),
      SeriesRowFragment
    );

    const { getByRole } = renderWithApollo(<SeriesRow series={series} />);

    await waitFor(() => {
      expect(getByRole('img')).toHaveAttribute('src', 'blob:test-cover');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/gid-book-21/cover?width=88');
  });

  it('renders a ghost layer (no img) for a book with hasCover: false', () => {
    const series = makeFragmentData(
      makeSeriesRowData({
        books: {
          __typename: 'SeriesBooksConnection',
          edges: [
            {
              __typename: 'SeriesBooksConnectionEdge',
              node: makeCoverNode({ hasCover: false }),
            },
          ],
        },
      }),
      SeriesRowFragment
    );

    const { queryByRole } = renderWithApollo(<SeriesRow series={series} />);

    expect(queryByRole('img')).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('omits the author segment when the series has none', () => {
    const series = makeFragmentData(makeSeriesRowData({ author: '' }), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('6 book series')).toBeInTheDocument();
  });

  it('omits the progress badge when no member book has started', () => {
    const series = makeFragmentData(
      makeSeriesRowData({ progressPercentage: null }),
      SeriesRowFragment
    );

    const { getByText, queryByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series')).toBeInTheDocument();
    expect(queryByText(/%|Completed/)).not.toBeInTheDocument();
  });

  // Formatting matches the REST version exactly (`e2a17228`): a rounded
  // percentage below 100%, "Completed" text at or above it.
  it('shows a rounded percentage badge when the series is partway through', () => {
    const series = makeFragmentData(
      makeSeriesRowData({ progressPercentage: 0.42 }),
      SeriesRowFragment
    );

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series · 42%')).toBeInTheDocument();
  });

  it('shows "Completed" instead of "100%" when every member book is fully read', () => {
    const series = makeFragmentData(
      makeSeriesRowData({ progressPercentage: 1 }),
      SeriesRowFragment
    );

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series · Completed')).toBeInTheDocument();
  });

  it('shows "0%", not the empty-progress state, when the only progress reads 0%', () => {
    const series = makeFragmentData(
      makeSeriesRowData({ progressPercentage: 0 }),
      SeriesRowFragment
    );

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series · 0%')).toBeInTheDocument();
  });

  it('navigates to the series page on click', async () => {
    const user = userEvent.setup();
    const series = makeFragmentData(
      makeSeriesRowData({ name: 'Dune Chronicles' }),
      SeriesRowFragment
    );

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);
    await user.click(getByText('Dune Chronicles'));

    expect(mocks.navigate).toHaveBeenCalledWith(path.series('Dune Chronicles'));
  });
});
