import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookEditDocument } from '~/graphql/book-edit';
import { renderHookWithApollo } from '~/test-utils';

import { useBookEdit } from './use-book-edit';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';

// `useBookEdit` reads the current library through `useCurrentLibraryId`
// (`~/provider/library-target`) — stubbed the same way
// `use-book-detail.test.tsx` stubs it, so these tests stay focused on
// `BookEditDocument` alone rather than also exercising the bootstrap query.
const currentLibraryId: string | undefined = LIBRARY_ID;
const currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
}));

const bookEditMock = (overrides: Record<string, unknown> = {}) => ({
  request: { query: BookEditDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          documentId: 'a'.repeat(32),
          title: 'A Wizard of Earthsea',
          titleSort: 'Wizard of Earthsea, A',
          author: 'Le Guin',
          authorSort: 'Le Guin, Ursula',
          description: 'A boy learns magic.',
          publisher: 'Harper',
          publishDate: '1968-01-01',
          seriesIndex: 1,
          subjects: ['Fantasy'],
          series: { __typename: 'Series' as const, id: 'U2VyaWVzOjE=', name: 'Earthsea' },
          identifiers: [
            { __typename: 'Identifier' as const, scheme: 'ISBN', value: '9780553383041' },
          ],
          validation: { __typename: 'Validation' as const, id: BOOK_ID, valid: true },
          ...overrides,
        },
      },
    },
  },
});

describe('useBookEdit', () => {
  it('returns the book with its sort fields and identifiers', async () => {
    const { result } = renderHookWithApollo(() => useBookEdit(BOOK_ID), [bookEditMock()]);

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book?.titleSort).toBe('Wizard of Earthsea, A');
    expect(result.current?.book?.identifiers).toHaveLength(1);
    expect(result.current?.book?.series?.name).toBe('Earthsea');
    expect(result.current?.error).toBeUndefined();
  });

  it('returns undefined book with NO error for an id the library does not have', async () => {
    const { result } = renderHookWithApollo(
      () => useBookEdit(BOOK_ID),
      [
        {
          request: {
            query: BookEditDocument,
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
      () => useBookEdit(BOOK_ID),
      [
        {
          request: {
            query: BookEditDocument,
            variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
          },
          error: new Error('network down'),
        },
      ]
    );

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.book).toBeUndefined();
  });

  it('reports a null series as no series, not an error', async () => {
    const { result } = renderHookWithApollo(
      () => useBookEdit(BOOK_ID),
      [bookEditMock({ series: null })]
    );

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current?.book?.series).toBeNull();
    expect(result.current?.error).toBeUndefined();
  });
});
