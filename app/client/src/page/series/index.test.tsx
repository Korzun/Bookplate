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

import { apiFetch } from '~/lib/api-fetch';
import { path } from '~/router';
import { renderWithApollo } from '~/test-utils';

import { SeriesDetailDocument } from './index';

const LIBRARY_ID = 'TGlicmFyeTox';

let isAdminValue = false;
vi.mock('~/provider/auth', () => ({ useIsAdmin: () => [isAdminValue] }));

// `SeriesPage` roots its query at `node(id: $libraryId)`, learned from
// `useCurrentLibraryId` (`~/provider/library-target`), which itself runs an
// unconditional `ViewerBootstrap` query — stubbing it directly (rather than
// adding a bootstrap mock to every `mocks` array below) keeps these tests
// focused on `SeriesDetailDocument` alone, matching
// `page/library/index.test.tsx`'s own convention.
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

  it('renders the book list from the series, with real cover images', async () => {
    const { findByText, getByText, getAllByRole } = await renderPage([seriesMock()]);

    await findByText('Earthsea');
    expect(getByText('A Wizard of Earthsea')).toBeInTheDocument();
    // Loose (`> 0`, not an exact count) deliberately: this exercises the
    // page's real, unmocked `CoverStack`/`Cover`/`BookRowFromSeriesBook`
    // tree end to end (the `beforeEach` above stubs `apiFetch` and
    // `URL.createObjectURL` for exactly this), not just that book text
    // renders. `CoverStack` contributes ghost `<div>`s for any of its 3
    // slots without a cover, and `BookRowFromSeriesBook`'s own row renders
    // an `<img>` only when `hasCover` — an exact count would be brittle
    // against either without adding coverage this test cares about.
    await waitFor(() => expect(getAllByRole('img').length).toBeGreaterThan(0));
  });

  // Task 5b: `SeriesDetailDocument` is now composed HERE, at the route — not
  // read through a `provider/library` hook. Two books proves the route's own
  // query drives BOTH rows, not just the single-book fixture every other
  // test in this file uses (which would pass even if only the first edge
  // were ever wired through).
  //
  // Order-sensitive (Task 5b review, Item 5), not presence-only:
  // `page/series/index.tsx` reshapes `series.books.edges` into `edge.node`
  // TWICE — once for `unmaskedBooks` (the React key source, `:132`), once
  // for the render itself (`:248`) — and nothing but both reading the SAME
  // `edges` array in the SAME order keeps `unmaskedBooks[index]` aligned
  // with the row actually rendered at that index. A future change to only
  // ONE of those two reshapes (e.g. filtering one but not the other) would
  // desync them silently: rows would still all be PRESENT, just keyed to
  // the wrong book past the point of divergence, which a presence-only
  // assertion cannot see but a DOM-order assertion can.
  it('renders two book rows, in order, from the route-composed query', async () => {
    const { findByText, getByText } = await renderPage([
      seriesMock({}, [
        { id: 'gid-book-1', title: 'A Wizard of Earthsea', seriesIndex: 1 },
        { id: 'gid-book-2', title: 'The Tombs of Atuan', seriesIndex: 2 },
      ]),
    ]);

    await findByText('A Wizard of Earthsea');
    const firstTitle = getByText('A Wizard of Earthsea');
    const secondTitle = getByText('The Tombs of Atuan');
    expect(
      firstTitle.compareDocumentPosition(secondTitle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  // Task 5b review, Item 2: the deleted `use-series-detail.test.tsx` carried
  // a CHECKED-IN `@ts-expect-error` proving `series.books` stayed a MASKED
  // ref, never unmasked centrally — that pin died with the hook. This
  // restores the same mechanism at the route: reads the query straight out
  // of the cache the way the app itself does, so the object is real data,
  // not a fabricated fixture.
  it('keeps series.books.edges[].node MASKED — the route must not unmask centrally', async () => {
    const { client, findByText } = await renderPage([seriesMock()]);
    await findByText('Earthsea');

    const cached = client.cache.readQuery({
      query: SeriesDetailDocument,
      variables: { libraryId: LIBRARY_ID, name: 'Earthsea' },
    });
    const seriesNode =
      cached?.node?.__typename === 'Library' ? cached.node.seriesByName : undefined;
    const book = seriesNode?.books.edges[0]?.node;

    // Masking in this codebase is a TYPE-level contract only —
    // `gql/fragment-masking.ts`'s generated `useFragment` is a plain
    // identity cast, and this app's `ApolloClient` never sets Apollo's real
    // `dataMasking` option — so the object the cache hands back still HAS
    // `title` at runtime, and the assertion below passes for real. The line
    // compiles only because `@ts-expect-error` is suppressing a real type
    // error: if `page/series/index.tsx` ever reshapes `series.books.edges`
    // into a plain object (defeating colocation — see that file's own doc
    // comment) and widens the node's declared type to something with a real
    // `.title`, this starts failing with "Unused '@ts-expect-error'
    // directive" under `tsc` (`npm run lint`).
    // @ts-expect-error — `title` isn't readable on a masked ref without `useFragment`.
    expect(book?.title).toBe('A Wizard of Earthsea');
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
