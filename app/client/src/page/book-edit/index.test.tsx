import { InMemoryCache } from '@apollo/client';
import type { MockedResponse } from '@apollo/client/testing';
import { act, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();

// `useParams().id` is the Relay GLOBAL id `page/book` links here with
// (`path.bookEdit(book.id)`).
const GLOBAL_ID = 'Qm9vazox';
const LIBRARY_ID = 'TGlicmFyeTox';

vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ id: GLOBAL_ID }),
  useNavigate: () => navigate,
}));

// The route roots through `useCurrentLibraryId` — stubbed the same way
// `page/book`'s own test stubs it, so these tests stay focused on
// `BookEditDocument`/`BookResolvePendingFixDocument` rather than also
// exercising the bootstrap query. `let`, not `const`: the "library id gate"
// tests below vary both.
let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;
vi.mock('~/provider/library-target', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/library-target')>();
  return {
    ...actual,
    useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
  };
});

const mockBookEditForm = vi.fn();
vi.mock('~/component', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BookEditForm: (props: { book: unknown }) => {
    mockBookEditForm(props);
    return <div>EDIT FORM</div>;
  },
}));

import { LibraryPendingFixesDocument, BookResolvePendingFixDocument } from '~/graphql/upload';
import { cacheConfig } from '~/provider/apollo';
import { renderWithApollo } from '~/test-utils';

import { BookEditDocument } from './index';
import { BookEditPage } from './index';

/**
 * The book fields that make this page show the GUARD rather than the form,
 * in ONE place: every test that wants a guarded book goes through here, so
 * the selection backing the guard can change without rewriting each of them.
 *
 * What "actionable" MEANS — a LIVE fix with at least one proposal carrying a
 * concrete `to`, advisory `to: null` ones never counting — is the SERVER's
 * rule now (`Book.hasActionablePendingFix`), and it is pinned under opposite
 * mutations in `app/server/graphql/schema/pending-fix/model.test.ts`. It
 * used to be pinned here, which required this page to SELECT the proposals —
 * the very selection that partially overwrote the shared `PendingFix` entity
 * and cost a spurious `LibraryPendingFixes` refetch per visit (see the
 * cache-coherence suite at the bottom of this file). What is left for this
 * file to prove is the routing: flag true → guard, flag false → form.
 */
function guardedBookFields() {
  return { hasActionablePendingFix: true };
}

function bookData(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Book' as const,
    id: GLOBAL_ID,
    title: 'X',
    titleSort: '',
    author: '',
    authorSort: '',
    description: '',
    publisher: '',
    publishDate: '',
    seriesIndex: 0,
    subjects: [],
    series: null,
    identifiers: [],
    validation: { __typename: 'Validation' as const, id: GLOBAL_ID, valid: true },
    hasActionablePendingFix: false,
    ...overrides,
  };
}

function bookEditMock(bookOverrides: Record<string, unknown> | null = {}) {
  return {
    request: { query: BookEditDocument, variables: { libraryId: LIBRARY_ID, bookId: GLOBAL_ID } },
    result: {
      data: {
        __typename: 'Query' as const,
        node: {
          __typename: 'Library' as const,
          id: LIBRARY_ID,
          book: bookOverrides === null ? null : bookData(bookOverrides),
        },
      },
    },
  };
}

/** The dismiss mutation's own response, in the shape the ACTUAL document
 * selects (`graphql/upload.ts`): `library { pendingFixes }` for the row list,
 * and `book { hasActionablePendingFix }` — now `false`, the fix having just
 * been dismissed — for the guard. Both land on entities this page already
 * reads, which is what proves the guard clears through ordinary cache
 * normalization rather than a hand-written `update`. */
function dismissMock(): MockedResponse {
  return {
    request: {
      query: BookResolvePendingFixDocument,
      variables: { id: GLOBAL_ID, action: 'DISMISS' },
    },
    result: {
      data: {
        __typename: 'Mutation' as const,
        bookResolvePendingFix: {
          __typename: 'BookResolvePendingFixPayload' as const,
          book: {
            __typename: 'Book' as const,
            id: GLOBAL_ID,
            title: 'X',
            author: '',
            hasActionablePendingFix: false,
          },
          library: {
            __typename: 'Library' as const,
            id: LIBRARY_ID,
            pendingFixes: [
              {
                __typename: 'PendingFix' as const,
                id: `FIX-${GLOBAL_ID}`,
                fileName: 'a.epub',
                fileSize: 1,
                book: { __typename: 'Book' as const, id: GLOBAL_ID, title: 'X', author: '' },
                state: {
                  __typename: 'PendingFixState' as const,
                  autoFixes: [],
                  appliedFixes: [],
                  proposals: [],
                  undo: { __typename: 'UndoSnapshot' as const, kind: 'DISMISS' as const },
                },
              },
            ],
          },
        },
      },
    },
  };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  navigate.mockClear();
  mockBookEditForm.mockClear();
  currentLibraryId = LIBRARY_ID;
  currentLibraryIdLoading = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(mocks: unknown[] = [bookEditMock()]) {
  return renderWithApollo(<BookEditPage />, { mocks: mocks as MockedResponse[] });
}

describe('BookEditPage', () => {
  it('shows a loading state while the book query is in flight', async () => {
    renderPage([{ ...bookEditMock(), delay: 100_000 }]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows "Book not found." for a null book', async () => {
    renderPage([bookEditMock(null)]);
    expect(await screen.findByText('Book not found.')).toBeInTheDocument();
  });

  // Checked BEFORE "Book not found." — a transport failure also leaves
  // `book` `undefined`, and OR-ing it into the not-found branch would
  // misreport a network failure as the book genuinely not existing (the same
  // ordering `page/series` and `page/book` both use, each citing the other).
  it('shows a distinct message on a transport failure, not "Book not found."', async () => {
    renderPage([
      {
        request: {
          query: BookEditDocument,
          variables: { libraryId: LIBRARY_ID, bookId: GLOBAL_ID },
        },
        error: new Error('network down'),
      },
    ]);
    expect(await screen.findByText('Failed to load book.')).toBeInTheDocument();
    expect(screen.queryByText('Book not found.')).not.toBeInTheDocument();
  });

  it('blocks editing when the book has never been validated (validation: null)', async () => {
    renderPage([bookEditMock({ validation: null })]);
    expect(await screen.findByText(/must pass validation/i)).toBeInTheDocument();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });

  it('blocks editing when validation.valid is false', async () => {
    renderPage([
      bookEditMock({
        validation: { __typename: 'Validation' as const, id: GLOBAL_ID, valid: false },
      }),
    ]);
    expect(await screen.findByText(/must pass validation/i)).toBeInTheDocument();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });

  it('shows the guard modal (not the form) when the book has an actionable pending fix', async () => {
    renderPage([bookEditMock(guardedBookFields())]);
    expect(await screen.findByText('Review fixes')).toBeInTheDocument();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });

  // The opposite mutation of the test above, and the one that keeps it from
  // passing vacuously: `hasActionablePendingFix: false` covers a book with no
  // fix at all, one whose proposals are all advisory, one with no proposals
  // left, and a TTL-expired row — the server decides which, and pins each of
  // those four separately.
  it('shows the form when the book has no actionable pending fix', async () => {
    renderPage();
    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
    expect(screen.queryByText('Review fixes')).toBeNull();
  });

  // The form's own fields ride in through `...BookEditFormFragment`, which
  // this route spreads but never reads itself, so the assertion checks a
  // FRAGMENT field (`titleSort`) rather than only the route's own `id` —
  // otherwise a document that dropped the spread entirely would still pass.
  it("passes the book straight through to BookEditForm's book prop", async () => {
    renderPage([
      bookEditMock({
        titleSort: 'Wizard of Earthsea, A',
        identifiers: [{ __typename: 'Identifier' as const, scheme: 'ISBN', value: '978' }],
        series: { __typename: 'Series' as const, id: 'U2VyaWVzOjE=', name: 'Earthsea' },
      }),
    ]);
    await waitFor(() => expect(mockBookEditForm).toHaveBeenCalled());
    expect(mockBookEditForm).toHaveBeenCalledWith(
      expect.objectContaining({
        book: expect.objectContaining({
          id: GLOBAL_ID,
          titleSort: 'Wizard of Earthsea, A',
          series: expect.objectContaining({ name: 'Earthsea' }),
          identifiers: [expect.objectContaining({ scheme: 'ISBN' })],
        }),
      })
    );
  });

  // A book with no series is not an error — the form renders with the series
  // switch off.
  it('renders the form for a book with no series', async () => {
    renderPage([bookEditMock({ series: null })]);
    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
  });

  describe('library id gate', () => {
    // No mocks at all: a query issued despite the `skip` would hit MockLink's
    // "No more mocked responses" and fail loudly rather than pass vacuously.
    // Counted first (below) so a query fired with the WRONG variables — which
    // is exactly what a removed `skip` produces, `libraryId: ''` — is caught
    // too, not silently unmatched.
    it('issues no operation while there is no library id to root on', async () => {
      currentLibraryId = undefined;
      let requests = 0;
      renderWithApollo(<BookEditPage />, {
        mocks: [
          {
            request: {
              query: BookEditDocument,
              variables: () => {
                requests += 1;
                return true;
              },
            },
            result: { data: { __typename: 'Query' as const, node: null } },
          } as unknown as MockedResponse,
        ],
      });

      expect(requests).toBe(0);
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    // A SKIPPED `useQuery` reports `loading: false` on its own, so without
    // folding `useCurrentLibraryId`'s own bootstrap loading in, a cold load
    // would flash "Book not found." for the whole ViewerBootstrap window.
    it('shows the loading state, not "Book not found.", while the library id is still resolving', () => {
      currentLibraryId = undefined;
      currentLibraryIdLoading = true;
      renderWithApollo(<BookEditPage />, { mocks: [] });

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('Book not found.')).toBeNull();
    });
  });

  // Proves `onDismissAndEdit` resolves through this page's OWN
  // `BookResolvePendingFixDocument` mutation, keyed on this book's GLOBAL id
  // rather than a queue-item id, and that the guard clears through ordinary
  // cache normalization — no hand-written `update`, no
  // `UploadProvider`/upload queue involved at all.
  //
  // The mechanism moved with the guard: it used to be the mutation's
  // `library { pendingFixes }` response re-writing the shared
  // `PendingFix:<id>` entity the guard read through. It is now that
  // response's `book { hasActionablePendingFix }` landing on the same
  // `Book:<id>` entity this page reads. DROP that one field from
  // `BookResolvePendingFixDocument` and this test fails — which is exactly
  // what it is for, since nothing else would notice.
  it('dismisses the pending fix and reveals the edit form, with no UploadProvider mounted', async () => {
    renderPage([bookEditMock(guardedBookFields()), dismissMock()]);

    const dismissButton = await screen.findByText('Dismiss fixes & edit');
    await act(async () => {
      dismissButton.click();
    });

    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
    expect(screen.queryByText('Review fixes')).toBeNull();
  });
});

/**
 * The measured regression this page's `pendingFix` selection used to cause.
 *
 * `LibraryPendingFixes` is watched APP-WIDE — `component/nav` (the badge) and
 * `provider/upload/hook/use-upload-queue.ts` each hold a live `useQuery` on
 * it — so its watcher is active for the whole time `/book-edit` is open, not
 * dormant. `PendingFixState` has no `id` and no `keyFields` entry in
 * `provider/apollo/cache.ts`, so it is NOT a normalized entity: the cache
 * replaces it WHOLESALE. A `BookEditDocument` that wrote a narrow `state`
 * into the shared `PendingFix:<id>` entity therefore destroyed the fuller
 * one already cached, turned that watcher's diff INCOMPLETE, and cost a
 * spurious refetch of a breadth-55 / complexity-4807 operation — the
 * client's second most expensive — once per book-edit visit to a book with a
 * pending fix.
 *
 * Asserted against a real normalized `InMemoryCache(cacheConfig)` and
 * `cache.diff()`, not a render: the refetch is the CONSEQUENCE, and an
 * incomplete diff on a watched query is what causes it. This test fails on
 * any selection that writes a partial `PendingFixState` from here.
 */
describe('cache coherence with the app-wide LibraryPendingFixes watcher', () => {
  const metadataFix = (to: string | null) => ({
    __typename: 'MetadataFix' as const,
    field: 'title',
    kind: 'k',
    from: 'a',
    to,
    reason: null,
    fromChips: null,
    toChips: null,
    changes: null,
  });

  // The FULL `PendingFixRowFragment` shape, which is what the app-wide
  // watcher actually holds — including the three sibling fields
  // (`autoFixes`, `appliedFixes`, `undo`) and the seven `MetadataFix` fields
  // beyond `to` that a narrowed write would drop.
  const pendingFixesData = {
    __typename: 'Query' as const,
    node: {
      __typename: 'Library' as const,
      id: LIBRARY_ID,
      pendingFixes: [
        {
          __typename: 'PendingFix' as const,
          id: `FIX-${GLOBAL_ID}`,
          fileName: 'a.epub',
          fileSize: 1,
          book: { __typename: 'Book' as const, id: GLOBAL_ID, title: 'X', author: '' },
          state: {
            __typename: 'PendingFixState' as const,
            autoFixes: [metadataFix('auto')],
            appliedFixes: [metadataFix('applied')],
            proposals: [metadataFix('b')],
            undo: { __typename: 'UndoSnapshot' as const, kind: 'ACCEPT' as const },
          },
        },
      ],
    },
  };

  const pendingFixesVariables = { libraryId: LIBRARY_ID };

  const seedPendingFixes = (cache: InMemoryCache) =>
    cache.writeQuery({
      query: LibraryPendingFixesDocument,
      variables: pendingFixesVariables,
      // The document spreads `PendingFixRowFragment`, so its generated type
      // expects `$fragmentRefs`-wrapped members; the cache is written with
      // the real, unmasked shape a server response carries.
      data: pendingFixesData as never,
    });

  const pendingFixesDiff = (cache: InMemoryCache) =>
    cache.diff({
      query: LibraryPendingFixesDocument,
      variables: pendingFixesVariables,
      optimistic: false,
      returnPartialData: true,
    });

  it('leaves a cached LibraryPendingFixes read complete after this page writes its own document', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedPendingFixes(cache);
    expect(pendingFixesDiff(cache).complete).toBe(true);

    cache.writeQuery({
      query: BookEditDocument,
      variables: { libraryId: LIBRARY_ID, bookId: GLOBAL_ID },
      data: {
        __typename: 'Query' as const,
        node: { __typename: 'Library' as const, id: LIBRARY_ID, book: bookData() },
      } as never,
    });

    expect(pendingFixesDiff(cache).complete).toBe(true);
  });

  // The other half: a book that HAS a live actionable fix is the case the
  // defect was measured on, so the write must stay harmless there too — not
  // merely on the `pendingFix: null` book above.
  it('leaves it complete for a book that has an actionable pending fix', () => {
    const cache = new InMemoryCache(cacheConfig);
    seedPendingFixes(cache);

    cache.writeQuery({
      query: BookEditDocument,
      variables: { libraryId: LIBRARY_ID, bookId: GLOBAL_ID },
      data: {
        __typename: 'Query' as const,
        node: {
          __typename: 'Library' as const,
          id: LIBRARY_ID,
          book: bookData(guardedBookFields()),
        },
      } as never,
    });

    expect(pendingFixesDiff(cache).complete).toBe(true);
  });
});
