import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  BookUpdateMetadataMutation,
  BookUpdateMetadataMutationVariables,
} from '~/gql/graphql';
import { BookEditDocument, BookUpdateMetadataDocument } from '~/graphql/book-edit';
import { renderHookWithApollo } from '~/test-utils';

vi.mock('~/lib/staged-upload', () => ({ stageUpload: vi.fn() }));

const { stageUpload } = await import('~/lib/staged-upload');
const mockStage = vi.mocked(stageUpload);

const { useUpdateBookMetadata } = await import('./use-update-book-metadata');

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';
const NEW_BOOK_ID = 'Qm9vazoy';

const cover = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });

// The bare minimum `Book` shape `BookUpdateMetadataPayload`'s `book`
// selection re-selects (see `graphql/book-edit.ts`) so a mock's `result.data`
// type-checks against `BookUpdateMetadataMutation` without hand-duplicating
// the whole selection at every call site.
const updatePayload = (
  overrides: Partial<{
    id: string;
    title: string;
    titleSort: string;
    author: string;
    authorSort: string;
    description: string;
    publisher: string;
    publishDate: string;
    seriesIndex: number;
    subjects: string[];
    identifiers: { scheme: string; value: string }[];
  }> = {}
): BookUpdateMetadataMutation => ({
  __typename: 'Mutation',
  bookUpdateMetadata: {
    __typename: 'BookUpdateMetadataPayload',
    book: {
      __typename: 'Book',
      id: overrides.id ?? BOOK_ID,
      documentId: 'a'.repeat(32),
      title: overrides.title ?? 'Dune',
      titleSort: overrides.titleSort ?? 'Dune',
      author: overrides.author ?? 'Herbert',
      authorSort: overrides.authorSort ?? 'Herbert, Frank',
      description: overrides.description ?? '',
      publisher: overrides.publisher ?? '',
      publishDate: overrides.publishDate ?? '',
      seriesIndex: overrides.seriesIndex ?? 0,
      subjects: overrides.subjects ?? [],
      series: null,
      identifiers: (overrides.identifiers ?? []).map((i) => ({
        __typename: 'Identifier' as const,
        ...i,
      })),
    },
  },
});

// Seeds a full pre-edit `Book:<id>` entity (via the same document
// `useBookEdit` reads) so the eviction test actually proves something:
// without a pre-existing entity, `cache.extract()` would never contain
// `Book:<old-id>` in the first place, and "not.toContain" would pass
// whether or not the hand-written `update` ever ran.
const seedBook = (client: ReturnType<typeof renderHookWithApollo>['client'], id: string) =>
  client.writeQuery({
    query: BookEditDocument,
    variables: { libraryId: LIBRARY_ID, bookId: id },
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        book: {
          __typename: 'Book',
          id,
          documentId: 'a'.repeat(32),
          title: 'Dune',
          titleSort: 'Dune',
          author: 'Herbert',
          authorSort: 'Herbert, Frank',
          description: '',
          publisher: '',
          publishDate: '',
          seriesIndex: 0,
          subjects: [],
          series: null,
          identifiers: [],
          validation: null,
        },
      },
    },
  });

describe('useUpdateBookMetadata', () => {
  it('returns an updateBookMetadata function and initial false/undefined state', () => {
    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), []);
    const [updateBookMetadata, saving, errorMessage] = result.current!;
    expect(typeof updateBookMetadata).toBe('function');
    expect(saving).toBe(false);
    expect(errorMessage).toBeUndefined();
  });

  it('stages the cover before mutating and passes the staged id', async () => {
    const order: string[] = [];
    mockStage.mockImplementation(async () => {
      order.push('stage');
      return 'staged-1';
    });
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New', stagedCoverId: 'staged-1' } },
      },
      result: () => {
        order.push('mutate');
        return { data: updatePayload({ title: 'New' }) };
      },
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New', cover });
    });

    // Ordering, not mere co-occurrence: the staged id cannot exist before staging.
    expect(order).toEqual(['stage', 'mutate']);
    expect(mockStage).toHaveBeenCalledWith(cover, 'cover');
    expect(returned).toEqual({ id: BOOK_ID, documentId: 'a'.repeat(32) });
  });

  it('does not stage when the patch carries no cover', async () => {
    mockStage.mockClear();
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: updatePayload({ title: 'New' }) },
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    await act(async () => {
      await result.current?.[0](BOOK_ID, { title: 'New' });
    });

    expect(mockStage).not.toHaveBeenCalled();
    // MockLink throws on an unmatched operation, so a stray `stagedCoverId` in
    // the input would fail to match this mock and surface as an error — that
    // is what makes the absence assertion load-bearing rather than decorative.
    expect(result.current?.[2]).toBeUndefined();
  });

  it('never fires the mutation when staging fails, and reports a cover-specific message', async () => {
    mockStage.mockRejectedValue(new Error('No file uploaded'));

    // EMPTY mock list: any mutation attempt would be an unmatched operation.
    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), []);
    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New', cover });
    });

    expect(returned).toBeUndefined();
    expect(result.current?.[2]).toMatch(/cover/i);
    // The message must name the cover, not read as a generic save failure —
    // the whole point of splitting Save into two phases is that the user can
    // tell which one broke.
    expect(result.current?.[2]).not.toMatch(/save/i);
  });

  it('evicts the old Book entity when the payload reports a different id', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: updatePayload({ id: NEW_BOOK_ID, title: 'New' }) },
    };

    const { result, client } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    act(() => seedBook(client, BOOK_ID));
    expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`]).toBeDefined();

    await act(async () => {
      await result.current?.[0](BOOK_ID, { title: 'New' });
    });

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).not.toContain(`Book:${BOOK_ID}`);
    const newEntity = extracted[`Book:${NEW_BOOK_ID}`] as { title: string };
    expect(newEntity.title).toBe('New');
  });

  it('does not evict when the id is unchanged', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: updatePayload({ id: BOOK_ID, title: 'New' }) },
    };

    const { result, client } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    act(() => seedBook(client, BOOK_ID));

    await act(async () => {
      await result.current?.[0](BOOK_ID, { title: 'New' });
    });

    const extracted = client.cache.extract() as NormalizedCacheObject;
    expect(Object.keys(extracted)).toContain(`Book:${BOOK_ID}`);
    const entity = extracted[`Book:${BOOK_ID}`] as { title: string };
    expect(entity.title).toBe('New');
  });

  it('maps BookHashCollisionError to errorMessage and resolves undefined', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookUpdateMetadata: {
            __typename: 'BookHashCollisionError',
            message: 'This book collides with another book already in the library.',
          },
        },
      },
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New' });
    });

    expect(returned).toBeUndefined();
    expect(result.current?.[2]).toBe(
      'This book collides with another book already in the library.'
    );
  });

  it('maps StagedUploadNotFoundError to errorMessage and resolves undefined', async () => {
    mockStage.mockResolvedValue('staged-1');
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New', stagedCoverId: 'staged-1' } },
      },
      result: {
        data: {
          __typename: 'Mutation',
          bookUpdateMetadata: {
            __typename: 'StagedUploadNotFoundError',
            message: 'The staged cover upload has expired. Please try again.',
          },
        },
      },
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New', cover });
    });

    expect(returned).toBeUndefined();
    expect(result.current?.[2]).toBe('The staged cover upload has expired. Please try again.');
  });

  it('sets errorMessage when the mutation resolves missing', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: { __typename: 'Mutation', bookUpdateMetadata: null } },
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);
    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New' });
    });

    expect(returned).toBeUndefined();
    expect(result.current?.[2]).toBe("Couldn't save your changes");
  });

  it('sets saving true during the request and resets it after', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: updatePayload({ title: 'New' }) },
      delay: 20,
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);

    act(() => {
      void result.current?.[0](BOOK_ID, { title: 'New' });
    });
    expect(result.current?.[1]).toBe(true);

    await waitFor(() => expect(result.current?.[1]).toBe(false));
    expect(result.current?.[2]).toBeUndefined();
  });

  // The `if (saving) return` guard is live code, not leftover REST-era
  // plumbing — it still needs its own coverage. Only ONE mock is queued: if
  // the guard were removed, the second call would try to consume a SECOND
  // response from a `MockLink` that has none left, surfacing as an error
  // instead of silently doing nothing.
  it('does not send a second request while the first is still in flight', async () => {
    const mutationMock: MockedResponse<
      BookUpdateMetadataMutation,
      BookUpdateMetadataMutationVariables
    > = {
      request: {
        query: BookUpdateMetadataDocument,
        variables: { input: { id: BOOK_ID, title: 'New' } },
      },
      result: { data: updatePayload({ title: 'New' }) },
      delay: 20,
    };

    const { result } = renderHookWithApollo(() => useUpdateBookMetadata(), [mutationMock]);

    act(() => {
      void result.current?.[0](BOOK_ID, { title: 'New' });
    });
    await waitFor(() => expect(result.current?.[1]).toBe(true));

    let returned: unknown;
    await act(async () => {
      returned = await result.current?.[0](BOOK_ID, { title: 'New' });
    });
    expect(returned).toBeUndefined();
    expect(result.current?.[2]).toBeUndefined();

    await waitFor(() => expect(result.current?.[1]).toBe(false));
  });
});
