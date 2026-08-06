import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), coverStackProps: vi.fn() }));

vi.mock('../cover-stack', () => ({
  CoverStack: (props: { seriesName: string; layerWidth: number; layerHeight: number }) => {
    mocks.coverStackProps(props);
    return <div data-testid="cover-stack" />;
  },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import { makeFragmentData } from '~/gql';
import type { SeriesRowFragmentFragment } from '~/gql/graphql';
import { SeriesRowFragment } from '~/graphql/library';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { SeriesRow } from './index';

const makeSeriesRowData = (
  overrides: Partial<SeriesRowFragmentFragment> = {}
): SeriesRowFragmentFragment => ({
  __typename: 'Series',
  id: 'gid-series-1',
  name: 'Dune Chronicles',
  author: 'Frank Herbert',
  bookCount: 6,
  seriesProgress: null,
  ...overrides,
});

describe('SeriesRow', () => {
  it('renders name, author and book count from the fragment without fetching', () => {
    // No `mocks` passed to renderWithApollo: the parent already has every
    // field rendered here, so `getByText` below only finds real content
    // because it's synchronous prop data — the same "gate render behind a
    // query's loading" seen-to-fail demonstrated on `BookRowFromEntry`
    // (task 7's report) would break this the same way. `CoverStack` is
    // mocked out because it deliberately keeps its own separate REST data
    // path (see this component's doc comment) — this test isolates
    // SeriesRow's own no-fetch property, not CoverStack's.
    const series = makeFragmentData(makeSeriesRowData(), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Dune Chronicles')).toBeInTheDocument();
    expect(getByText('Frank Herbert · 6 book series')).toBeInTheDocument();
  });

  it('passes seriesName (and the existing layer size) through to CoverStack', () => {
    const series = makeFragmentData(makeSeriesRowData({ name: 'Foundation' }), SeriesRowFragment);

    renderWithApollo(<SeriesRow series={series} />);

    expect(mocks.coverStackProps).toHaveBeenCalledWith({
      seriesName: 'Foundation',
      layerWidth: 44,
      layerHeight: 66,
    });
  });

  it('omits the author segment when the series has none', () => {
    const series = makeFragmentData(makeSeriesRowData({ author: '' }), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('6 book series')).toBeInTheDocument();
  });

  it('omits the progress badge when no member book has started', () => {
    const series = makeFragmentData(makeSeriesRowData({ seriesProgress: null }), SeriesRowFragment);

    const { getByText, queryByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series')).toBeInTheDocument();
    expect(queryByText(/%|Completed/)).not.toBeInTheDocument();
  });

  // Formatting matches the REST version exactly (`e2a17228`): a rounded
  // percentage below 100%, "Completed" text at or above it.
  it('shows a rounded percentage badge when the series is partway through', () => {
    const series = makeFragmentData(makeSeriesRowData({ seriesProgress: 0.42 }), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series · 42%')).toBeInTheDocument();
  });

  it('shows "Completed" instead of "100%" when every member book is fully read', () => {
    const series = makeFragmentData(makeSeriesRowData({ seriesProgress: 1 }), SeriesRowFragment);

    const { getByText } = renderWithApollo(<SeriesRow series={series} />);

    expect(getByText('Frank Herbert · 6 book series · Completed')).toBeInTheDocument();
  });

  it('shows "0%", not the empty-progress state, when the only progress reads 0%', () => {
    const series = makeFragmentData(makeSeriesRowData({ seriesProgress: 0 }), SeriesRowFragment);

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
