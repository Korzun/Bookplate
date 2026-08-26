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

import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { renderWithApollo } from '~/test-utils';

import { BookEditDocument } from './index';
import { BookEditPage } from './index';

/** A `pendingFix` selection (`BookEditDocument`'s own inline field, Task
 * 11 — no `usePendingFixesForBook`/`LibraryPendingFixesDocument` lookup
 * anymore: the guard now reads straight off the book this page already
 * loads). `proposals` non-empty is what makes it a real conflict. */
function pendingFixOf(proposals: unknown[] = [proposal()]) {
  return {
    __typename: 'PendingFix' as const,
    id: `FIX-${GLOBAL_ID}`,
    state: { __typename: 'PendingFixState' as const, proposals },
  };
}

/** `BookEditDocument` selects `proposals { to }` and nothing else — `to` is
 * the only field the guard below reads, and `UploadFixGuardModal` takes no
 * data props at all. A proposal with a concrete `to` is an ACTIONABLE one. */
function proposal() {
  return { __typename: 'MetadataFix' as const, to: 'b' };
}

/** A flag-only ("needs review") proposal: `to === null`, no `changes`. The
 * server can never apply one — `bookResolvePendingFix`'s ACCEPT filters to
 * `to !== null` and leaves these behind — so `FixReview` gives them an Edit
 * link to THIS page instead of Accept/Reject. That makes them the one kind
 * of proposal the guard must not block on: there is no suggested value for
 * editing to overwrite, and blocking sends the user back to the only screen
 * that offered the Edit link. */
function advisoryProposal() {
  return { ...proposal(), to: null };
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
    pendingFix: null,
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

/** The dismiss mutation's own response: `library.pendingFixes` is what the
 * ACTUAL document selects (`graphql/upload.ts`'s doc comment) — it does not
 * re-select `book.pendingFix` directly, so this proves the guard clears
 * through ordinary cache normalization (the resolved row shares the same
 * `PendingFix:<id>` entity `Book.pendingFix` points at), not a hand-written
 * `update`. */
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
          book: { __typename: 'Book' as const, id: GLOBAL_ID, title: 'X', author: '' },
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

  it('shows the guard modal (not the form) when fixes are pending', async () => {
    renderPage([bookEditMock({ pendingFix: pendingFixOf() })]);
    expect(await screen.findByText('Review fixes')).toBeInTheDocument();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
  });

  it('shows the form when no fixes are pending', async () => {
    renderPage();
    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
  });

  // A live `PendingFix` row can carry `proposals: []` (fully resolved,
  // `undo` still armed within `isLivePendingFix`'s TTL) — that is not a
  // conflict, only a NON-EMPTY proposals list is.
  it('shows the form, not the guard, when the pending fix has no proposals left', async () => {
    renderPage([bookEditMock({ pendingFix: pendingFixOf([]) })]);
    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
    expect(screen.queryByText('Review fixes')).toBeNull();
  });

  // REGRESSION: an advisory-only book used to trip the guard, whose "Review
  // fixes" sends the user back to /upload — the only screen offering the Edit
  // link that brought them here. An unbreakable loop, because ACCEPT can never
  // clear a `to: null` proposal.
  it('shows the form, not the guard, when every remaining proposal is advisory', async () => {
    renderPage([bookEditMock({ pendingFix: pendingFixOf([advisoryProposal()]) })]);
    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
    expect(screen.queryByText('Review fixes')).toBeNull();
  });

  // The other half: a book with even ONE actionable proposal must still guard,
  // or this fix would have silently deleted the protection instead of scoping
  // it. Editing here really could strand a concrete pending suggestion.
  it('still guards when an actionable proposal remains alongside an advisory one', async () => {
    renderPage([bookEditMock({ pendingFix: pendingFixOf([advisoryProposal(), proposal()]) })]);
    expect(await screen.findByText('Review fixes')).toBeInTheDocument();
    expect(screen.queryByText('EDIT FORM')).toBeNull();
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

  // Proves `onDismissAndEdit` resolves through `useFixActions` (this book's
  // own GLOBAL id) rather than a queue-item id, and that the guard clears
  // via ordinary cache normalization once the mutation's `library
  // { pendingFixes }` response updates the shared `PendingFix:<id>` entity —
  // no `UploadProvider`/upload queue involved at all.
  it('dismisses the pending fix and reveals the edit form, with no UploadProvider mounted', async () => {
    renderPage([bookEditMock({ pendingFix: pendingFixOf() }), dismissMock()]);

    const dismissButton = await screen.findByText('Dismiss fixes & edit');
    await act(async () => {
      dismissButton.click();
    });

    expect(await screen.findByText('EDIT FORM')).toBeInTheDocument();
    expect(screen.queryByText('Review fixes')).toBeNull();
  });
});
