import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BookValidateMutation, BookValidateMutationVariables } from '~/gql/graphql';
import { BookDetailDocument, BookValidateDocument } from '~/graphql/book';
import { renderHookWithApollo } from '~/test-utils';

import { useValidateBook } from './use-validate-book';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';
const bookDetailVariables = { libraryId: LIBRARY_ID, bookId: BOOK_ID };

const freshValidation = {
  __typename: 'Validation' as const,
  id: BOOK_ID,
  valid: true,
  threshold: 'ERROR' as const,
  validatedAt: '2026-08-13T00:00:00.000Z',
  counts: [
    { __typename: 'ValidationSeverityCount' as const, severity: 'ERROR' as const, count: 0 },
  ],
  messages: { __typename: 'ValidationMessagesConnection' as const, edges: [] },
};

const validateSuccessMock = (
  id: string
): MockedResponse<BookValidateMutation, BookValidateMutationVariables> => ({
  request: { query: BookValidateDocument, variables: { id } },
  result: {
    data: {
      __typename: 'Mutation',
      bookValidate: {
        __typename: 'BookValidatePayload',
        book: { __typename: 'Book', id },
        validation: freshValidation,
      },
    },
  },
});

// Same shallow `Book.validation { id valid }` shape `use-book-detail.test.tsx`
// seeds with — `useValidateBook` relies on `Validation.id` being
// byte-identical to the owning Book's global id (`graphql/book.ts`'s doc
// comment) so the mutation's fuller payload merges onto the SAME
// `Validation:<id>` entity this establishes, rather than writing a second,
// disconnected one.
const seedBookDetail = (
  client: ReturnType<typeof renderHookWithApollo>['client'],
  valid: boolean
) =>
  client.writeQuery({
    query: BookDetailDocument,
    variables: bookDetailVariables,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          __typename: 'Book',
          id: BOOK_ID,
          documentId: 'a'.repeat(32),
          title: 'A Wizard of Earthsea',
          author: 'Le Guin',
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
          validation: { __typename: 'Validation', id: BOOK_ID, valid },
          lineage: [],
          pendingFix: null,
        },
      },
    },
  });

describe('useValidateBook', () => {
  it('returns a validateBook function and initial loading false', () => {
    const { result } = renderHookWithApollo(() => useValidateBook(), []);
    const [validateBook, loading] = result.current!;
    expect(typeof validateBook).toBe('function');
    expect(loading).toBe(false);
  });

  it('resolves the fresh (masked) validation fragment ref on success', async () => {
    const { result } = renderHookWithApollo(
      () => useValidateBook(),
      [validateSuccessMock(BOOK_ID)]
    );

    let returned: unknown;
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    // Fragment masking is compile-time only (never `dataMasking`-enabled
    // here) — the runtime value is the plain object the mock returned, so a
    // deep-equal assertion is the honest one. Do NOT assert
    // `not.toHaveProperty` to "prove" masking; that would assert a
    // falsehood (Global Constraints).
    expect(returned).toEqual(freshValidation);
  });

  // The task's real content: `bookValidate`'s payload carries `validation`
  // as a TOP-LEVEL field (not nested under `book`), so this is NOT a
  // "the payload happens to re-select book.validation" case — it only lands
  // on the Book's own cached `validation` field because `Validation.id` is
  // the owning Book's global id, so both queries' reads of `Book.validation`
  // resolve to the SAME `Validation:<id>` entity this mutation just wrote.
  // No hand-written `update` function exists for this hook; this is the
  // proof normalization alone does the job.
  it('writes the fresh validation onto the book via normalization, with no manual update', async () => {
    const { result, client } = renderHookWithApollo(
      () => useValidateBook(),
      [validateSuccessMock(BOOK_ID)]
    );
    act(() => seedBookDetail(client, false));

    await act(() => result.current![0](BOOK_ID));

    const cached = client.cache.readQuery({
      query: BookDetailDocument,
      variables: bookDetailVariables,
    });
    const validation =
      cached?.node?.__typename === 'Library' ? cached.node.book?.validation : undefined;
    expect(validation?.valid).toBe(true);
  });

  it('resolves undefined when the mutation resolves missing (book not found for this owner)', async () => {
    const { result } = renderHookWithApollo(
      () => useValidateBook(),
      [
        {
          request: { query: BookValidateDocument, variables: { id: BOOK_ID } },
          result: { data: { __typename: 'Mutation' as const, bookValidate: null } },
        },
      ]
    );

    let returned: unknown = 'not-undefined';
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    expect(returned).toBeUndefined();
  });

  it('resolves undefined when the mutation throws', async () => {
    const { result } = renderHookWithApollo(
      () => useValidateBook(),
      [
        {
          request: { query: BookValidateDocument, variables: { id: BOOK_ID } },
          error: new Error('Network error'),
        },
      ]
    );

    let returned: unknown = 'not-undefined';
    await act(async () => {
      returned = await result.current![0](BOOK_ID);
    });

    expect(returned).toBeUndefined();
  });

  it('sets loading true during the request and resets it after', async () => {
    const { result } = renderHookWithApollo(
      () => useValidateBook(),
      [{ ...validateSuccessMock(BOOK_ID), delay: 20 }]
    );

    act(() => {
      void result.current![0](BOOK_ID);
    });
    expect(result.current![1]).toBe(true);

    await waitFor(() => expect(result.current![1]).toBe(false));
  });
});
