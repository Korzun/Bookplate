import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookRegenChaptersMutation, BookRegenChaptersMutationVariables } from '~/gql/graphql';
import { BookDetailDocument, BookRegenChaptersDocument } from '~/graphql/book';
import { renderHookWithApollo } from '~/test-utils';

import { useRegenChapters } from './use-regen-chapters';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'book-1';
const NEW_BOOK_ID = 'book-1-new-hash';

// Seeds a full pre-regen `Book:<id>` entity (via the same document
// `useBookDetail` reads) so the eviction test below actually proves
// something: without a pre-existing entity, `cache.extract()` would never
// contain `Book:<old-id>` in the first place, and "not.toContain" would
// pass whether or not `update` ever ran.
const seedBook = (client: ReturnType<typeof renderHookWithApollo>['client'], id: string) =>
  client.writeQuery({
    query: BookDetailDocument,
    variables: { libraryId: LIBRARY_ID, bookId: id },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          __typename: 'Book',
          id,
          title: 'Dune',
          author: 'Herbert',
          description: '',
          publisher: '',
          publishDate: '',
          addedAt: '2026-01-01T00:00:00.000Z',
          mtime: '2026-01-01T00:00:00.000Z',
          size: 0,
          pageCount: 0,
          chapterCount: 0,
          chapterNames: null,
          chapterSpineMap: [],
          subjects: [],
          seriesIndex: 0,
          hasCover: false,
          coverUrl: '',
          deviceEditionCount: 0,
          series: null,
          progress: null,
          validation: null,
          lineage: [],
          pendingFix: null,
        },
      },
    },
  });

const regenSuccessMock = (
  requestedId: string,
  responseId: string
): MockedResponse<BookRegenChaptersMutation, BookRegenChaptersMutationVariables> => ({
  request: { query: BookRegenChaptersDocument, variables: { id: requestedId } },
  result: {
    data: {
      __typename: 'Mutation',
      bookRegenChapters: {
        __typename: 'BookRegenChaptersPayload',
        book: {
          __typename: 'Book',
          id: responseId,
          chapterCount: 5,
          chapterNames: ['One', 'Two'],
          chapterSpineMap: [0, 10],
        },
      },
    },
  },
});

describe('useRegenChapters', () => {
  it('returns a regenChapters function and initial false/undefined state', () => {
    const { result } = renderHookWithApollo(() => useRegenChapters(), []);
    const [regenChapters, loading, error, errorMessage] = result.current!;
    expect(typeof regenChapters).toBe('function');
    expect(loading).toBe(false);
    expect(error).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('updates chapter fields on the same Book entity via normalization when the id is unchanged', async () => {
    const { result, client } = renderHookWithApollo(
      () => useRegenChapters(),
      [regenSuccessMock(BOOK_ID, BOOK_ID)]
    );
    act(() => seedBook(client, BOOK_ID));

    await act(() => result.current![0](BOOK_ID));

    const extracted = client.cache.extract() as NormalizedCacheObject;
    const entity = extracted[`Book:${BOOK_ID}`] as { chapterCount: number };
    expect(entity.chapterCount).toBe(5);
  });

  // The task's real content: `reimportBook` can change the book's content-
  // hash global id. Normalization alone would then write a NEW `Book:<new-
  // id>` entity and leave the stale `Book:<old-id>` entity — with its
  // pre-regen `chapterCount`/`chapterNames`/`chapterSpineMap` — sitting in
  // the cache forever, since nothing else ever reads or evicts it. The
  // hand-written `update` evicts the old entity in that case.
  it('evicts the old Book entity when the payload reports a different id (hash changed)', async () => {
    const { result, client } = renderHookWithApollo(
      () => useRegenChapters(),
      [regenSuccessMock(BOOK_ID, NEW_BOOK_ID)]
    );
    act(() => seedBook(client, BOOK_ID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`]).toBeDefined();

    await act(() => result.current![0](BOOK_ID));

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Book:${BOOK_ID}`);
    const newEntity = extracted[`Book:${NEW_BOOK_ID}`] as { chapterCount: number };
    expect(newEntity.chapterCount).toBe(5);
  });

  it('maps a BookHashCollisionError to errorMessage', async () => {
    const { result } = renderHookWithApollo(
      () => useRegenChapters(),
      [
        {
          request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
          result: {
            data: {
              __typename: 'Mutation' as const,
              bookRegenChapters: {
                __typename: 'BookHashCollisionError' as const,
                message: 'This book collides with another book already in the library.',
              },
            },
          },
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('This book collides with another book already in the library.');
  });

  it('maps a BookNotValidatedError to errorMessage', async () => {
    const { result } = renderHookWithApollo(
      () => useRegenChapters(),
      [
        {
          request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
          result: {
            data: {
              __typename: 'Mutation' as const,
              bookRegenChapters: {
                __typename: 'BookNotValidatedError' as const,
                message: 'This book must pass validation before it can be edited.',
              },
            },
          },
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('This book must pass validation before it can be edited.');
  });

  it('sets error when the mutation resolves missing (book not found for this owner)', async () => {
    const { result } = renderHookWithApollo(
      () => useRegenChapters(),
      [
        {
          request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
          result: { data: { __typename: 'Mutation' as const, bookRegenChapters: null } },
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Failed to regenerate chapters');
  });

  it('sets error and errorMessage when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useRegenChapters(),
      [
        {
          request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
          error: new Error('Network error'),
        },
      ]
    );

    await act(() => result.current![0](BOOK_ID));

    expect(result.current![2]).toBe(true);
    expect(result.current![3]).toBe('Network error');
  });

  it('sets loading true during the request and resets it after', async () => {
    const { result } = renderHookWithApollo(
      () => useRegenChapters(),
      [{ ...regenSuccessMock(BOOK_ID, BOOK_ID), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    expect(result.current![1]).toBe(true);

    await waitFor(() => expect(result.current![1]).toBe(false));
    expect(result.current![2]).toBe(false);
  });
});
