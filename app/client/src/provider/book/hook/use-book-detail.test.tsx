import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookDetailDocument } from '~/graphql/book';
import { renderHookWithApollo } from '~/test-utils';

import { useBookDetail } from './use-book-detail';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';

// `useBookDetail` reads the current library through `useCurrentLibraryId`
// (`~/provider/library-target`), which itself runs an unconditional
// `ViewerBootstrapDocument` query — see `use-library-entries.test.tsx` for
// the same stub. Stubbing it directly (rather than adding a bootstrap mock
// to every `mocks` array below) keeps these tests focused on
// `BookDetailDocument` alone. Mutable (not the static form
// `use-series-detail.test.tsx` uses) because the "issues no operation"
// test below needs to flip `libraryId` to `undefined` for one case, exactly
// like `use-library-entries.test.tsx`'s own convention.
let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const bookMock = (overrides: Record<string, unknown> = {}) => ({
  request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          title: 'A Wizard of Earthsea',
          author: 'Le Guin',
          description: 'A boy learns magic.',
          publisher: 'Harper',
          publishDate: '1968-01-01',
          addedAt: '2026-01-01T00:00:00.000Z',
          mtime: '2026-01-01T00:00:00.000Z',
          size: 1_000_000,
          pageCount: 200,
          chapterCount: 12,
          chapterNames: ['One'],
          chapterSpineMap: [0],
          subjects: ['Fantasy'],
          seriesIndex: 1,
          hasCover: true,
          coverUrl: '/api/books/1/cover?user=le&v=1',
          deviceEditionCount: 2,
          series: { __typename: 'Series' as const, id: 'U2VyaWVzOjE=', name: 'Earthsea' },
          progress: {
            __typename: 'Progress' as const,
            id: 'UHJvZ3Jlc3M6MQ==',
            percentage: 0.2,
            currentChapter: 3,
          },
          validation: {
            __typename: 'Validation' as const,
            id: BOOK_ID,
            valid: true,
          },
          lineage: [],
          pendingFix: null,
          ...overrides,
        },
      },
    },
  },
});

describe('useBookDetail', () => {
  it('returns the book with masked validation and lineage refs', async () => {
    const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), [bookMock()]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book?.title).toBe('A Wizard of Earthsea');
    // `validation { id valid }` is selected DIRECTLY on BookDetail (not through a
    // fragment) since the 2026-08-13 lazy split, so it is plainly readable here —
    // `editingBlocked` depends on it at page load.
    expect(result.current?.book?.validation?.valid).toBe(true);
    // `lineage` DOES come through a fragment. Masking is compile-time only, so
    // prove it at the type level, not by asserting a missing runtime property.
    // @ts-expect-error — `timestamp` is masked behind LineageEntryFragment
    void result.current?.book?.lineage?.[0]?.timestamp;
  });

  it('returns undefined book for an id the library does not have', async () => {
    const { result } = renderHookWithApollo(
      () => useBookDetail(BOOK_ID),
      [
        {
          request: {
            query: BookDetailDocument,
            variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
          },
          result: {
            data: {
              __typename: 'Query' as const,
              node: { __typename: 'Library' as const, id: LIBRARY_ID, book: null },
            },
          },
        },
      ]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book).toBeUndefined();
    expect(result.current?.error).toBeUndefined();
  });

  it('surfaces a transport failure as a message string', async () => {
    const { result } = renderHookWithApollo(
      () => useBookDetail(BOOK_ID),
      [
        {
          request: {
            query: BookDetailDocument,
            variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
          },
          error: new Error('network down'),
        },
      ]
    );

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.book).toBeUndefined();
  });

  it('issues no operation until the library id resolves', () => {
    // `useCurrentLibraryId` is stubbed to `undefined` for this case, the
    // same convention `use-library-entries.test.tsx` uses for its own
    // cold-load test — see the doc comment on the mutable state above.
    currentLibraryId = undefined;
    currentLibraryIdLoading = true;
    try {
      // An empty MockLink throws on any unmatched operation, so reaching
      // the assertion below without an error IS the proof that nothing
      // was sent.
      const { result } = renderHookWithApollo(() => useBookDetail(BOOK_ID), []);

      expect(result.current?.loading).toBe(true);
    } finally {
      currentLibraryId = LIBRARY_ID;
      currentLibraryIdLoading = false;
    }
  });

  it('refetch re-issues the query', async () => {
    const { result } = renderHookWithApollo(
      () => useBookDetail(BOOK_ID),
      [bookMock(), bookMock({ title: 'Renamed' })]
    );

    await waitFor(() => expect(result.current?.book?.title).toBe('A Wizard of Earthsea'));
    result.current?.refetch();
    await waitFor(() => expect(result.current?.book?.title).toBe('Renamed'));
  });
});
