import type { MockedResponse } from '@apollo/client/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ name: 'Best 100' }),
  useNavigate: () => vi.fn(),
}));

import { apiFetch } from '~/lib/api-fetch';
import { renderWithApollo } from '~/test-utils';

import { CollectionDetailDocument } from './index';

const LIBRARY_ID = 'TGlicmFyeTox';

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const mockApiFetch = vi.mocked(apiFetch);

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  mockApiFetch.mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['img'], { type: 'image/jpeg' })),
  } as Response);
});

afterEach(() => {
  mockApiFetch.mockReset();
});

// Wire-shaped (unmasked) mocks, as in `page/series/index.test.tsx`.
const membership = (id: string, title: string, position: number | null) => ({
  __typename: 'BookCollectionMembership' as const,
  position,
  book: {
    __typename: 'Book' as const,
    id,
    title,
    seriesIndex: 0,
    hasCover: false,
    thumbnailUrl: '/api/books/1/cover?width=88',
    progress: null,
    rating: { __typename: 'BookRating', overall: null },
  },
});

const request = {
  query: CollectionDetailDocument,
  variables: { libraryId: LIBRARY_ID, name: 'Best 100' },
};

const collectionMock = (): MockedResponse => ({
  request,
  result: {
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        collectionByName: {
          __typename: 'Collection',
          id: 'gid-collection-1',
          name: 'Best 100',
          bookCount: 3,
          books: {
            __typename: 'CollectionBooksConnection',
            edges: [
              membership('b1', 'Third in List', 2),
              membership('b2', 'Fourth in List', 77),
              membership('b3', 'Unpositioned', null),
            ].map((node) => ({ __typename: 'CollectionBooksConnectionEdge', node })),
          },
        },
      },
    },
  },
});

const notFoundMock = (): MockedResponse => ({
  request,
  result: {
    data: {
      __typename: 'Query',
      node: { __typename: 'Library', id: LIBRARY_ID, collectionByName: null },
    },
  },
});

async function renderPage(mocks: MockedResponse[]) {
  const { CollectionPage } = await import('./index');
  return renderWithApollo(<CollectionPage />, { mocks });
}

describe('CollectionPage', () => {
  it('renders the name, the book count and books in API order with positions', async () => {
    const { findByRole, getByText, container } = await renderPage([collectionMock()]);

    expect(await findByRole('heading', { name: 'Best 100' })).toBeInTheDocument();
    expect(getByText('3 books')).toBeInTheDocument();

    const titles = ['Third in List', 'Fourth in List', 'Unpositioned'];
    const text = container.textContent ?? '';
    const indexes = titles.map((t) => text.indexOf(t));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);

    expect(getByText('#2')).toBeInTheDocument();
    expect(getByText('#77')).toBeInTheDocument();
    expect(container.textContent).not.toContain('#null');
  });

  it('renders the not-found state for an unknown collection', async () => {
    const { findByText } = await renderPage([notFoundMock()]);

    expect(await findByText('Collection not found.')).toBeInTheDocument();
  });
});
