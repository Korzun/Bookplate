import type { NormalizedCacheObject } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookEditFormFragment } from '~/component/book-edit-form';
import { makeFragmentData } from '~/gql';
import type {
  BookAnalyzeReplaceMutation,
  BookAnalyzeReplaceMutationVariables,
  BookReplaceMutation,
  BookReplaceMutationVariables,
} from '~/gql/graphql';
import { BookAnalyzeReplaceDocument, BookReplaceDocument } from '~/graphql/upload';
import type { ReplaceAnalysis } from '~/lib/book-types';
import { BookEditDocument } from '~/page/book-edit';
import { LibraryEntriesDocument } from '~/page/library';
import { renderHookWithApollo } from '~/test-utils';

import type { ReplacedBook } from './use-replace-book';

// Same convention `use-update-book-metadata.test.tsx` uses: mock the named
// export so `mockStage` can assert call counts/args without hitting the real
// REST staging seam.
vi.mock('~/lib/staged-upload', () => ({ stageUpload: vi.fn() }));

const { stageUpload } = await import('~/lib/staged-upload');
const mockStage = vi.mocked(stageUpload);

const { useReplaceBook } = await import('./use-replace-book');

const BOOK_GID = 'Qm9vazox';
const NEW_BOOK_GID = 'Qm9vazoy';
const STAGED_ID = 'staged-1';
const LIBRARY_ID = 'TGlicmFyeTox';

// `BookReplacePayload` carries only `book` — no `library { id }` the way
// `BookDeletePayload` does — so the hook resolves the library to evict from
// `useCurrentLibraryId()`. Same stub `use-update-book-metadata.test.tsx`
// uses for the identical reason.
vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const ENTRIES_VARS = { libraryId: LIBRARY_ID, first: 20, filter: undefined };

// Deliberately UNANNOTATED — `LibraryEntriesQuery`'s `Book` node member is
// masked behind `BookRowFragment`'s `$fragmentRefs`, so an explicitly typed
// literal fails `tsc`'s excess-property check. Same idiom as
// `use-update-book-metadata.test.tsx`'s `bookRowNode`.
const bookRowNode = (id: string) => ({
  __typename: 'Book' as const,
  id,
  title: 'Old Title',
  author: 'Old Author',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
});

/** Seeds the grid's own connection so the invalidation assertions prove the
 * CACHE was invalidated, not merely that the mutation resolved. */
const seedLibraryEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.writeQuery({
    query: LibraryEntriesDocument,
    variables: ENTRIES_VARS,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: [
            {
              __typename: 'LibraryEntriesConnectionEdge' as const,
              cursor: 'c1',
              node: bookRowNode(BOOK_GID),
            },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = (client: ReturnType<typeof renderHookWithApollo>['client']) =>
  client.cache.readQuery({ query: LibraryEntriesDocument, variables: ENTRIES_VARS });

/** Seeds a pre-replace `Book:<id>` through the document `page/book-edit`
 * reads. The `Library.book(id:)` field it creates is what keeps the old
 * entity alive past `cache.gc()` — the eviction has to name it. */
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
          validation: null,
          pendingFix: null,
          // The form's own fields ride in through the colocated fragment, the
          // sanctioned cast from a concrete shape to the masked one.
          ...makeFragmentData(
            {
              __typename: 'Book',
              id,
              title: 'Old Title',
              titleSort: 'Old Title',
              author: 'Old Author',
              authorSort: 'Author, Old',
              description: '',
              publisher: '',
              publishDate: '',
              seriesIndex: 0,
              subjects: [],
              series: null,
              identifiers: [],
            },
            BookEditFormFragment
          ),
        },
      },
    },
  });

const file = new File(['bytes'], 'replacement.epub', { type: 'application/epub+zip' });

const fixRow = (
  overrides: Partial<{ field: string; kind: string; from: string; to: string | null }> = {}
) => ({
  __typename: 'MetadataFix' as const,
  field: overrides.field ?? 'title',
  kind: overrides.kind ?? 'replace',
  from: overrides.from ?? 'Old',
  to: overrides.to ?? 'Dune',
  reason: null,
  fromChips: null,
  toChips: null,
  changes: null,
});

const analyzeMock: MockedResponse<BookAnalyzeReplaceMutation, BookAnalyzeReplaceMutationVariables> =
  {
    request: {
      query: BookAnalyzeReplaceDocument,
      variables: { id: BOOK_GID, stagedUploadId: STAGED_ID },
    },
    result: {
      data: {
        __typename: 'Mutation',
        bookAnalyzeReplace: {
          __typename: 'BookAnalyzeReplacePayload',
          valid: true,
          autoFixes: [],
          proposals: [fixRow()],
        },
      },
    },
  };

const replaceMock: MockedResponse<BookReplaceMutation, BookReplaceMutationVariables> = {
  request: {
    query: BookReplaceDocument,
    variables: { id: BOOK_GID, stagedUploadId: STAGED_ID, acceptedFixKeys: ['title:replace:Old'] },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookReplace: {
        __typename: 'BookReplacePayload',
        book: { __typename: 'Book', id: NEW_BOOK_GID, title: 'Dune', author: 'Herbert' },
      },
    },
  },
};

const replaceCollisionMock: MockedResponse<BookReplaceMutation, BookReplaceMutationVariables> = {
  request: {
    query: BookReplaceDocument,
    variables: { id: BOOK_GID, stagedUploadId: STAGED_ID, acceptedFixKeys: [] },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookReplace: {
        __typename: 'BookHashCollisionError',
        message: 'This book collides with another book already in the library.',
      },
    },
  },
};

// The `analyzeReplacement` counterpart to `replaceCollisionMock`: a typed
// union-error member of `BookAnalyzeReplaceResult` rather than the
// `BookAnalyzeReplacePayload` success arm. Proves the
// `if (result.status !== 'ok') return undefined;` branch inside
// `analyzeReplacement` actually resolves `undefined` (and resets
// `analyzing`) instead of crashing or returning a malformed analysis.
const analyzeStagedUploadNotFoundMock: MockedResponse<
  BookAnalyzeReplaceMutation,
  BookAnalyzeReplaceMutationVariables
> = {
  request: {
    query: BookAnalyzeReplaceDocument,
    variables: { id: BOOK_GID, stagedUploadId: STAGED_ID },
  },
  result: {
    data: {
      __typename: 'Mutation',
      bookAnalyzeReplace: {
        __typename: 'StagedUploadNotFoundError',
        message: 'The staged upload could not be found.',
      },
    },
  },
};

describe('useReplaceBook', () => {
  beforeEach(() => {
    mockStage.mockReset();
  });

  describe('analyzeReplacement', () => {
    it('stages the file once and analyzes the staged id', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(() => useReplaceBook(), [analyzeMock]);

      let analysis: ReplaceAnalysis | undefined;
      await act(async () => {
        analysis = await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      expect(mockStage).toHaveBeenCalledTimes(1);
      expect(mockStage).toHaveBeenCalledWith(file, 'epub');
      expect(analysis?.valid).toBe(true);
      expect(analysis?.proposals).toHaveLength(1);
      expect(analysis?.proposals[0]).toMatchObject({
        field: 'title',
        kind: 'replace',
        from: 'Old',
      });
    });

    it('returns undefined and does not analyze when staging throws', async () => {
      mockStage.mockRejectedValue(new Error('Failed to upload the file'));
      const { result } = renderHookWithApollo(() => useReplaceBook(), []);

      let analysis: ReplaceAnalysis | undefined;
      await act(async () => {
        analysis = await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      expect(analysis).toBeUndefined();
    });

    it('does not send a second analyze request while the first is still in flight', async () => {
      mockStage.mockReturnValue(new Promise(() => {}));
      const { result } = renderHookWithApollo(() => useReplaceBook(), []);

      act(() => {
        void result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await waitFor(() => expect(result.current?.analyzing).toBe(true));

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      expect(mockStage).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when the analysis resolves a typed error, and resets analyzing', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(
        () => useReplaceBook(),
        [analyzeStagedUploadNotFoundMock]
      );

      let analysis: ReplaceAnalysis | undefined;
      await act(async () => {
        analysis = await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      expect(analysis).toBeUndefined();
      // Discriminates against a version that threw or left the flag stuck:
      // a stuck `analyzing` would leave the Validating… state showing
      // forever, and a throw would have surfaced as an unhandled rejection
      // in this same `act` block above.
      expect(result.current?.analyzing).toBe(false);
    });
  });

  describe('commitReplacement', () => {
    it('commits the SAME staged id the analysis used, without re-staging', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceMock,
      ] as MockedResponse[]);

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      let replaced: ReplacedBook | undefined;
      await act(async () => {
        replaced = await result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });

      expect(mockStage).toHaveBeenCalledTimes(1); // not twice
      expect(replaced?.id).toBe(NEW_BOOK_GID);
    });

    // REGRESSION (whole-step review I-1). A replace rotates the book id AND
    // rewrites title/author — exactly what the grid sorts, filters and
    // renders — yet `runReplace` carried no `update` at all, so `/library`
    // kept the pre-replace row (and an edge pointing at the old id) until a
    // hard reload. Every sibling mutation that moves a book in the
    // connection evicts the field; this one is the only one that changes
    // what the connection is ordered by.
    it('evicts the LibraryEntries connection after a successful replace', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result, client } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceMock,
      ] as MockedResponse[]);
      act(() => seedLibraryEntries(client));
      expect(readEntries(client)).not.toBeNull();

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });

      expect(readEntries(client)).toBeNull();
    });

    // Same `applyEpubChanges`-style id rotation `use-update-book-metadata.ts`
    // and `use-fix-actions.ts` handle: normalization writes a brand-new
    // `Book:<newId>` and cannot know the old entity described the same book,
    // and `cache.gc()` cannot collect the orphan while a `Library.book(id:)`
    // field from a prior /book or /book-edit visit still references it.
    it('evicts the old Book entity when the replace rotates the id', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result, client } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceMock,
      ] as MockedResponse[]);
      act(() => seedBook(client, BOOK_GID));
      expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_GID}`]).toBeDefined();

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });

      expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
        `Book:${BOOK_GID}`
      );
    });

    // The failure half: a typed error carries no payload, so nothing may be
    // evicted — the book was not replaced and the grid is still correct.
    it('evicts nothing when the replace fails', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result, client } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceCollisionMock,
      ] as MockedResponse[]);
      act(() => seedLibraryEntries(client));

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, []);
      });

      expect(readEntries(client)).not.toBeNull();
    });

    it('surfaces a typed replace error and returns undefined', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceCollisionMock,
      ] as MockedResponse[]);
      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      let replaced: ReplacedBook | undefined;
      await act(async () => {
        replaced = await result.current?.commitReplacement(BOOK_GID, []);
      });

      expect(replaced).toBeUndefined();
      await waitFor(() => expect(result.current?.commitError).toBeDefined());
      expect(result.current?.commitError).toBe(
        'This book collides with another book already in the library.'
      );
    });

    it('clears commitError at the start of a new commitReplacement call', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        replaceCollisionMock,
        analyzeMock,
        replaceMock,
      ] as MockedResponse[]);

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, []);
      });
      expect(result.current?.commitError).toBeDefined();

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });
      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });
      expect(result.current?.commitError).toBeUndefined();
    });

    it('does nothing when no file has been analyzed/staged yet', async () => {
      const { result } = renderHookWithApollo(() => useReplaceBook(), []);

      let replaced: ReplacedBook | undefined;
      await act(async () => {
        replaced = await result.current?.commitReplacement(BOOK_GID, []);
      });

      expect(replaced).toBeUndefined();
      expect(mockStage).not.toHaveBeenCalled();
    });

    it('does not send a second commit request while the first is still in flight', async () => {
      mockStage.mockResolvedValue(STAGED_ID);
      const { result } = renderHookWithApollo(() => useReplaceBook(), [
        analyzeMock,
        { ...replaceMock, delay: 1_000_000 },
      ] as MockedResponse[]);

      await act(async () => {
        await result.current?.analyzeReplacement(BOOK_GID, file);
      });

      act(() => {
        void result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });
      await waitFor(() => expect(result.current?.committing).toBe(true));

      await act(async () => {
        await result.current?.commitReplacement(BOOK_GID, ['title:replace:Old']);
      });

      // Only ONE replace mock was ever consumed — a second real attempt would
      // have thrown ("no more mocked responses") instead of resolving undefined.
      expect(result.current?.committing).toBe(true);
    });
  });

  it('makes no /api/books call', async () => {
    mockStage.mockResolvedValue(STAGED_ID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHookWithApollo(() => useReplaceBook(), [analyzeMock]);

    await act(async () => {
      await result.current?.analyzeReplacement(BOOK_GID, file);
    });

    const bookRoutes = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/books/'));
    expect(bookRoutes.map(([u]) => String(u))).toEqual([]); // staging is mocked above
    fetchSpy.mockRestore();
  });
});
