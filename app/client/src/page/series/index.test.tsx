import type { MockedResponse } from '@apollo/client/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ name: 'Earthsea' }),
  useNavigate: () => routerMocks.navigate,
}));

import { SeriesDetailDocument } from '~/graphql/series';
import { apiFetch } from '~/lib/api-fetch';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

const LIBRARY_ID = 'TGlicmFyeTox';

let isAdminValue = false;
vi.mock('~/provider/auth', () => ({ useIsAdmin: () => [isAdminValue] }));

// `useSeriesDetail` roots its query at `node(id: $libraryId)`, learned from
// `useCurrentLibraryId` (`~/provider/library-target`), which itself runs an
// unconditional `ViewerBootstrap` query — stubbing it directly (rather than
// adding a bootstrap mock to every `mocks` array below) keeps these tests
// focused on `SeriesDetailDocument` alone, matching
// `use-series-detail.test.tsx`'s own convention.
vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const mockApiFetch = vi.mocked(apiFetch);

const makeOkResponse = (blob: Blob) => ({ ok: true, blob: () => Promise.resolve(blob) });

beforeEach(() => {
  isAdminValue = false;
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  mockApiFetch.mockResolvedValue(
    makeOkResponse(new Blob(['img'], { type: 'image/jpeg' })) as Response
  );
});

afterEach(() => {
  mockApiFetch.mockReset();
});

// These mocks are deliberately NOT typed as `MockedResponse<SeriesDetailQuery>`
// — `renderWithApollo`'s own doc comment (`~/test-utils.tsx`) explains why:
// `SeriesDetailQuery`'s generated TYPE is the MASKED shape (a book node
// carries only `id` plus a `$fragmentRefs` marker, not `title`/`thumbnailUrl`/
// etc. as real properties), but MockLink needs the actual WIRE shape — the
// full fields a real server response contains, since masking here is a
// compile-time-only contract, never applied at runtime. Annotating these
// literals against the masked type would make every field beyond `id` an
// "unknown property" error.
const makeBookNode = (overrides: Partial<Record<string, unknown>> = {}) => ({
  __typename: 'Book' as const,
  id: 'gid-book-1',
  title: 'A Wizard of Earthsea',
  seriesIndex: 1,
  hasCover: true,
  thumbnailUrl: '/api/books/1/cover?width=88',
  progress: null,
  ...overrides,
});

const seriesMock = (
  overrides: Partial<Record<string, unknown>> = {},
  bookOverrides: Partial<Record<string, unknown>>[] = [{}]
): MockedResponse => ({
  request: {
    query: SeriesDetailDocument,
    variables: { libraryId: LIBRARY_ID, name: 'Earthsea' },
  },
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        seriesByName: {
          __typename: 'Series',
          id: 'gid-series-1',
          name: 'Earthsea',
          author: 'Ursula K. Le Guin',
          publisher: 'Parnassus Press',
          totalPages: 900,
          totalSize: 3_000_000,
          subjects: ['Fantasy'],
          progressPercentage: null,
          books: {
            __typename: 'SeriesBooksConnection',
            edges: bookOverrides.map((bookOverride) => ({
              __typename: 'SeriesBooksConnectionEdge',
              node: makeBookNode(bookOverride),
            })),
          },
          ...overrides,
        },
      },
    },
  },
});

const notFoundMock = (): MockedResponse => ({
  request: {
    query: SeriesDetailDocument,
    variables: { libraryId: LIBRARY_ID, name: 'Earthsea' },
  },
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, seriesByName: null },
    },
  },
});

const errorMock = (): MockedResponse => ({
  request: {
    query: SeriesDetailDocument,
    variables: { libraryId: LIBRARY_ID, name: 'Earthsea' },
  },
  error: new Error('network down'),
});

async function renderPage(mocks: MockedResponse[]) {
  const { SeriesPage } = await import('./index');
  return renderWithApollo(<SeriesPage />, { mocks });
}

describe('SeriesPage', () => {
  it('shows a loading state while the series is still resolving', async () => {
    const { getByText } = await renderPage([]);

    expect(getByText('Loading…')).toBeInTheDocument();
  });

  it('shows "Series not found" for a null series', async () => {
    const { getByText, findByText } = await renderPage([notFoundMock()]);

    await findByText('Series not found.');
    expect(getByText('Series not found.')).toBeInTheDocument();
  });

  it('shows a distinct message on a transport failure, not "Series not found"', async () => {
    const { findByText, queryByText } = await renderPage([errorMock()]);

    await findByText('Failed to load series.');
    expect(queryByText('Series not found.')).not.toBeInTheDocument();
  });

  it('renders the metadata list (pages, publisher, size)', async () => {
    const { findByText, getByText } = await renderPage([seriesMock()]);

    await findByText('Earthsea');
    expect(getByText('900')).toBeInTheDocument();
    expect(getByText('Parnassus Press')).toBeInTheDocument();
    expect(getByText('2.9 MB')).toBeInTheDocument();
  });

  it('renders the subjects card', async () => {
    const { findByText, getByText } = await renderPage([seriesMock()]);

    await findByText('Earthsea');
    expect(getByText('Subjects')).toBeInTheDocument();
    expect(getByText('Fantasy')).toBeInTheDocument();
  });

  it('renders the book list from the series', async () => {
    const { findByText, getByText } = await renderPage([seriesMock()]);

    await findByText('Earthsea');
    expect(getByText('A Wizard of Earthsea')).toBeInTheDocument();
  });

  it("navigates to the author's filtered library view on click", async () => {
    const user = userEvent.setup();
    const { findByText } = await renderPage([seriesMock()]);

    await findByText('Earthsea');
    await user.click(await findByText('Ursula K. Le Guin'));

    expect(routerMocks.navigate).toHaveBeenCalledWith(
      path.library({ author: 'Ursula K. Le Guin' })
    );
  });

  it('shows the progress badge from Series.progressPercentage for a non-admin', async () => {
    const { findByText } = await renderPage([seriesMock({ progressPercentage: 0.5 })]);

    await findByText('Earthsea');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('hides the progress metadata entirely for an admin', async () => {
    isAdminValue = true;
    const { findByText, queryByText } = await renderPage([seriesMock({ progressPercentage: 0.5 })]);

    await findByText('Earthsea');
    expect(queryByText('progress:')).not.toBeInTheDocument();
  });

  it('renders no progress badge when progressPercentage is null', async () => {
    const { findByText } = await renderPage([seriesMock({ progressPercentage: null })]);

    await findByText('Earthsea');
    // An unstarted series shows NO badge — not a "0%" one. This is the exact
    // distinction `Series.progressPercentage`'s null-vs-0 semantics exist to
    // carry (parent spec §15), so it is the one worth pinning.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it("renders per-row progress from each book's own SeriesBookRowFragment", async () => {
    // This is the shim Task 6 left behind (`makeFragmentData` fabricating a
    // ref with `progress: null`), removed by this task: the fragment's own
    // `progress { percentage }` now flows straight to `BookRowFromSeriesBook`
    // with no fabrication in between.
    const { findByText, getByText } = await renderPage([
      seriesMock({}, [{ progress: { __typename: 'Progress', id: 'p-1', percentage: 0.5 } }]),
    ]);

    await findByText('Earthsea');
    await waitFor(() => {
      expect(getByText('Book 1 · 50%')).toBeInTheDocument();
    });
  });
});
