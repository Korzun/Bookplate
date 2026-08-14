import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFragment } from '~/gql';
import { BookValidationDocument, ValidationFragment } from '~/graphql/book';
import { renderHookWithApollo } from '~/test-utils';

import { useBookValidation } from './use-book-validation';

const LIBRARY_ID = 'TGlicmFyeTox';
const BOOK_ID = 'Qm9vazox';

// Same stub convention `use-series-detail.test.tsx` and
// `use-book-detail.test.tsx` use — keeps these tests focused on
// `BookValidationDocument` alone rather than also mocking
// `ViewerBootstrapDocument`.
vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
}));

const validationMock = () => ({
  request: { query: BookValidationDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          validation: {
            __typename: 'Validation' as const,
            id: BOOK_ID,
            valid: false,
            threshold: 'ERROR',
            validatedAt: '2026-01-01T00:00:00.000Z',
            counts: [
              { __typename: 'ValidationSeverityCount' as const, severity: 'ERROR', count: 1 },
            ],
            messages: {
              __typename: 'ValidationMessagesConnection' as const,
              edges: [
                {
                  __typename: 'ValidationMessagesConnectionEdge' as const,
                  node: {
                    __typename: 'ValidationMessage' as const,
                    seq: 1,
                    severity: 'ERROR',
                    message: 'Bad markup',
                    code: 'RSC-005',
                    path: 'OEBPS/ch1.xhtml',
                    line: 10,
                    column: 3,
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
});

describe('useBookValidation', () => {
  it('issues no operation until load() is called', () => {
    // An empty MockLink throws on any unmatched operation, so rendering the
    // hook and reaching the assertion below without an error IS the proof
    // that mounting this hook alone never fires `BookValidationDocument` —
    // the entire reason the 2026-08-13 split exists.
    const { result } = renderHookWithApollo(() => useBookValidation(BOOK_ID), []);

    expect(result.current?.loading).toBe(false);
    expect(result.current?.validation).toBeUndefined();
  });

  it('fetches the validation payload once load() is called', async () => {
    const { result } = renderHookWithApollo(() => useBookValidation(BOOK_ID), [validationMock()]);

    expect(result.current?.validation).toBeUndefined();

    act(() => {
      result.current?.load();
    });

    await waitFor(() => expect(result.current?.validation).toBeDefined());
    const validation = useFragment(ValidationFragment, result.current?.validation);
    expect(validation?.valid).toBe(false);
    expect(validation?.threshold).toBe('ERROR');
    expect(validation?.counts).toHaveLength(1);
  });

  it('surfaces a transport failure as a message string', async () => {
    const { result } = renderHookWithApollo(
      () => useBookValidation(BOOK_ID),
      [
        {
          request: {
            query: BookValidationDocument,
            variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
          },
          error: new Error('network down'),
        },
      ]
    );

    act(() => {
      result.current?.load();
    });

    await waitFor(() => expect(result.current?.error).toBe('network down'));
    expect(result.current?.validation).toBeUndefined();
  });
});
