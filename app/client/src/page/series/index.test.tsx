import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithApollo } from '~/test-utils';

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ name: 'Foundation' }),
  useNavigate: () => vi.fn(),
}));

const mockUseSeries = vi.fn();
const mockUseSeriesBookList = vi.fn();
vi.mock('~/provider/book', () => ({
  useSeries: (name: string) => mockUseSeries(name),
  useSeriesBookList: (name: string) => mockUseSeriesBookList(name),
}));

vi.mock('~/provider/auth', () => ({ useIsAdmin: () => [false, false, false, undefined] }));
vi.mock('~/provider/progress', () => ({
  useMySeriesProgress: () => [undefined, false, false, undefined],
  useMyProgress: () => [undefined, false, false, undefined],
}));
vi.mock('~/provider/library-target', () => ({
  useWithTargetUser: () =>
    Object.assign((url: string) => url, { ready: true, username: undefined }),
}));
vi.mock('~/lib/use-authorized-src', () => ({ useAuthorizedSrc: () => 'blob:test-cover' }));

const makeBook = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'book-1',
  title: 'Foundation',
  author: 'Isaac Asimov',
  titleSort: '',
  authorSort: '',
  publishDate: '',
  publisher: '',
  series: 'Foundation',
  seriesIndex: 1,
  subjects: [],
  identifiers: [],
  hasCover: true,
  size: 0,
  mtime: '2024-01-01T00:00:00.000Z',
  addedAt: '2024-01-01',
  chapterCount: 0,
  pageCount: 0,
  ...overrides,
});

const makeSeriesMeta = (overrides: Partial<Record<string, unknown>> = {}) => ({
  name: 'Foundation',
  subjects: ['Science Fiction'],
  bookCount: 1,
  author: 'Isaac Asimov',
  publisher: 'Gnome Press',
  totalPages: 255,
  totalSize: 1048576,
  ...overrides,
});

beforeEach(() => {
  mockUseSeries.mockReset();
  mockUseSeriesBookList.mockReset();
});

async function renderPage() {
  const { SeriesPage } = await import('./index');
  return renderWithApollo(<SeriesPage />);
}

describe('SeriesPage', () => {
  /**
   * The regression `page/series/index.tsx:43-50` (pre-fix line numbers) let
   * ship: `booksError` ORed into the not-found branch, fed by
   * `useSeriesBookList` filtering a REST list frozen at page 1
   * (`use-series-book-list.test.ts`'s own seen-to-fail covers that hook's
   * half of the fix). This test covers the OTHER half — that the page
   * itself renders real content, not "Series not found", once the hook
   * DOES resolve a series' books, using the real `CoverStack`/`BookRowFromBook`
   * components rather than mocking them away.
   */
  it('renders the series (not "Series not found") once its books resolve', async () => {
    mockUseSeries.mockReturnValue([makeSeriesMeta(), false, false, undefined]);
    mockUseSeriesBookList.mockReturnValue([[makeBook()], false, false, undefined]);

    const { getAllByText, queryByText, getAllByRole } = await renderPage();

    expect(queryByText('Series not found.')).not.toBeInTheDocument();
    expect(getAllByText('Foundation').length).toBeGreaterThan(0);
    expect(getAllByRole('img').length).toBeGreaterThan(0);
  });

  it('shows "Series not found" when the series genuinely has no books', async () => {
    mockUseSeries.mockReturnValue([makeSeriesMeta(), false, false, undefined]);
    mockUseSeriesBookList.mockReturnValue([undefined, false, true, 'Unknown series Foundation']);

    const { getByText } = await renderPage();

    expect(getByText('Series not found.')).toBeInTheDocument();
  });

  it('shows a loading state while the series books are still resolving', async () => {
    mockUseSeries.mockReturnValue([undefined, true, false, undefined]);
    mockUseSeriesBookList.mockReturnValue([undefined, true, false, undefined]);

    const { getByText } = await renderPage();

    expect(getByText('Loading…')).toBeInTheDocument();
  });
});
