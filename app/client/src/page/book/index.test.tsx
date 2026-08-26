import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

const BOOK_ID = 'Qm9vazox'; // Book:1
const LIBRARY_ID = 'TGlicmFyeTox'; // Library:1

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useParams: () => ({ id: 'Qm9vazox' }),
  useNavigate: () => routerMocks.navigate,
}));

// `UploadReplaceModal` is the only `~/control` export replaced with a spy —
// every other modal in this file (`BookLineageModal`, `ConfirmModal`,
// `ValidationDetailModal`) renders for REAL, because this task's whole point
// is proving those two close real debts (lineage history, the validate
// modal), not merely that the page CALLS them.
const replaceModalSpy = vi.hoisted(() => vi.fn(() => null));
vi.mock('~/control', async (orig) => {
  const actual = await orig<typeof import('~/control')>();
  return { ...actual, UploadReplaceModal: replaceModalSpy };
});

// `page/book`'s own read and its lazy validation read both root through
// `useCurrentLibraryId` (an unconditional `ViewerBootstrap` query) — stubbed
// directly, the same convention `page/series/index.test.tsx` uses, to keep
// these tests focused on `BookDetailDocument`/`BookValidateDocument`.
// `useWithTargetUser` is ALSO stubbed here (not left to the real provider):
// `useDownloadBook` (`~/lib`, a permanent REST seam) calls it.
//
// MUTABLE, not the static `() => ({ libraryId: LIBRARY_ID, loading: false })`
// form (review round 1, Item 1): a static stub makes `page/book`'s own
// `skip: libraryId === undefined` and its `loading: bookLoading ||
// libraryIdLoading` fold UNREACHABLE from this file, so both could be
// deleted with every test still green. The deleted `use-book-detail.test.tsx`
// was the only thing exercising them; this mirrors
// `page/library/index.test.tsx`'s own mutable stub, which exists for the
// same reason. `beforeEach` restores both to the resolved values.
let currentLibraryId: string | undefined = LIBRARY_ID;
let currentLibraryIdLoading = false;

vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: currentLibraryId, loading: currentLibraryIdLoading }),
  useWithTargetUser: () =>
    Object.assign((url: string) => url, { ready: true, username: undefined }),
}));

import type { NormalizedCacheObject } from '@apollo/client';

import { makeFragmentData } from '~/gql';
import type {
  BookChaptersQuery,
  BookLineageQuery,
  LineageEntryFragmentFragment,
} from '~/gql/graphql';
import {
  BookClearEditionsDocument,
  BookDeleteDocument,
  BookRegenChaptersDocument,
  BookValidateDocument,
  LineageEntryFragment,
} from '~/graphql/book';
import { ProgressDeleteDocument, ProgressSetDocument } from '~/graphql/progress';
import { ViewerBootstrapDocument } from '~/graphql/viewer-bootstrap';
import { apiFetch } from '~/lib/api-fetch';
import { renderWithApollo } from '~/test-utils';

import {
  BookChaptersDocument,
  BookDetailDocument,
  BookLineageDocument,
  BookValidationDocument,
} from './query';

const mockApiFetch = vi.mocked(apiFetch);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  // `ProportionalChapterSlider` (inside `SetProgressModal`) drives its
  // `onChange` off real `PointerEvent`s — same polyfill/stub
  // `proportional-chapter-slider/index.test.tsx` uses, needed here too for
  // the "clear progress" regression test to drag the slider to chapter 0.
  Element.prototype.setPointerCapture = vi.fn();
  if (!window.PointerEvent) {
    class PointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(window, 'PointerEvent', { value: PointerEvent, writable: true });
  }
});

beforeEach(() => {
  routerMocks.navigate.mockClear();
  replaceModalSpy.mockClear();
  chapterCounter.requests = 0;
  lineageCounter.requests = 0;
  bookDetailCounter.requests = 0;
  validationReadCounter.requests = 0;
  currentLibraryId = LIBRARY_ID;
  currentLibraryIdLoading = false;
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  // Progress reads/writes are GraphQL now (Apollo mocks, not `apiFetch`) —
  // the only real `apiFetch` consumer left in this page's render tree is the
  // cover `blob()` fetch (`useAuthorizedSrc`).
  mockApiFetch.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' })),
    } as Response)
  );
});

afterEach(() => {
  mockApiFetch.mockReset();
});

// Lifted from Task 8's `use-book-detail.test.tsx` fixture — every case below
// varies one field of it. `documentId` (Task 10b) is a RAW content hash,
// deliberately DIFFERENT from `BOOK_ID` (the Relay global id) so a test can
// tell, from rendered text alone, which one a component actually used.
const DOCUMENT_ID = 'raw-content-hash-aaaa1111';

const validationFixture = { __typename: 'Validation' as const, id: BOOK_ID, valid: true };

const rawLineageEntry = (
  overrides: Partial<LineageEntryFragmentFragment> = {}
): LineageEntryFragmentFragment => ({
  __typename: 'LinkedDocument',
  oldId: 'doc-old-hash',
  newId: 'doc-current-hash',
  timestamp: '2026-06-01T00:00:00.000Z',
  type: 'EDIT',
  ...overrides,
});

/**
 * Counts EVERY `BookDetail` operation, whatever variables it carries, then
 * reports whether those variables match. Count-first is deliberate: the
 * "issues no operation until the library id resolves" test needs to catch a
 * removed `skip` gate, and a query fired with `libraryId: ''` would slip
 * past a matcher that counted only on a successful match.
 */
const bookDetailCounter = { requests: 0 };

const bookMock = (overrides: Record<string, unknown> = {}): MockedResponse => ({
  request: {
    query: BookDetailDocument,
    variables: function bookDetailVariables(vars) {
      bookDetailCounter.requests += 1;
      return vars.libraryId === LIBRARY_ID && vars.bookId === BOOK_ID;
    },
  },
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          documentId: DOCUMENT_ID,
          title: 'A Wizard of Earthsea',
          author: 'Le Guin',
          description: 'A boy learns magic.',
          publisher: 'Harper',
          publishDate: '1968-01-01',
          mtime: '2026-01-01T00:00:00.000Z',
          size: 1_000_000,
          pageCount: 200,
          chapterCount: 12,
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
          validation: validationFixture,
          ...overrides,
        },
      },
    },
  },
});

/**
 * The two LAZY split documents (2026-08-26). Each factory counts its own
 * requests through `MockLink`'s VARIABLE-MATCHER form of `request.variables`
 * — a function `MockLink.request()` calls SYNCHRONOUSLY, in the same tick
 * the operation is issued (`mockLink.js`, the `mocks.findIndex` matcher).
 *
 * That synchronous point is the whole reason the matcher is used instead of
 * the far more obvious `result: () => { count++; … }`. A `result` function
 * runs on DELIVERY, and `MockLink`'s default delay is `realisticDelay()` —
 * a RANDOM 20-50ms. A "does NOT fire" assertion counted at delivery
 * therefore passes or fails on timing luck: it was seen to let an
 * eager-by-mistake `BookChapters` through in one test while catching it in
 * its neighbour. Counted at REQUEST time, an eagerly-issued query has
 * already incremented before the page's first `await` resolves, so
 * `expect(requests).toBe(0)` fails CLOSED with no tuned wait anywhere —
 * Task 6's lesson applied directly.
 *
 * `maxUsageCount: Infinity`: several tests below deliberately fire the same
 * lazy query more than once (prefetch on hover, then the real `useQuery` on
 * open). Under the default of 1, the SECOND would fail as "No more mocked
 * responses" and mask the assertion the test is actually making.
 */
const chapterCounter = { requests: 0 };
const chaptersMock = (
  chapterNames: string[] | null = ['Shadows', 'The Bright Fire', 'The School for Wizards']
): MockedResponse<BookChaptersQuery> => ({
  request: {
    query: BookChaptersDocument,
    variables: function bookChaptersVariables(vars) {
      chapterCounter.requests += 1;
      return vars.libraryId === LIBRARY_ID && vars.bookId === BOOK_ID;
    },
  },
  maxUsageCount: Infinity,
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          chapterNames,
          chapterSpineMap: [0],
        },
      },
    },
  },
});

const lineageCounter = { requests: 0 };
const lineageMock = (
  lineage: LineageEntryFragmentFragment[] = []
): MockedResponse<BookLineageQuery> => ({
  request: {
    query: BookLineageDocument,
    variables: function bookLineageVariables(vars) {
      lineageCounter.requests += 1;
      return vars.libraryId === LIBRARY_ID && vars.bookId === BOOK_ID;
    },
  },
  maxUsageCount: Infinity,
  result: {
    data: {
      __typename: 'Query' as const,
      node: {
        __typename: 'Library' as const,
        id: LIBRARY_ID,
        book: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          addedAt: '2026-01-01T00:00:00.000Z',
          // `__typename` alongside the masked ref, not inside it:
          // `makeFragmentData` returns only the `$fragmentRefs` marker, and a
          // MockLink result missing `__typename` silently fails to normalize
          // (see `src/test-utils.tsx`).
          lineage: lineage.map((entry) => ({
            __typename: 'LinkedDocument' as const,
            ...makeFragmentData(entry, LineageEntryFragment),
          })),
        },
      },
    },
  },
});

/**
 * A failed LAZY read. Before the split (review round 1, Item 2) a failure to
 * read `lineage` was a failed PAGE load; split out and defaulted (`?? []`),
 * the same failure would render the modal's EMPTY-lineage presentation
 * instead — the page stating "no edit history" when the truth is "we could
 * not find out". These two mocks are what pin the distinction.
 */
const lineageErrorMock = (): MockedResponse<BookLineageQuery> => ({
  request: { query: BookLineageDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  error: new Error('lineage read failed'),
});

const chaptersErrorMock = (): MockedResponse<BookChaptersQuery> => ({
  request: { query: BookChaptersDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  error: new Error('chapters read failed'),
});

const VIEWER_USER_ID = 'VXNlcjox'; // User:1

// `useSetMyProgress` reads the viewer's `User.id` off an unconditional
// `ViewerBootstrapDocument` query fired the moment `SetProgressModal`
// mounts (i.e. as soon as the modal opens, whether or not it's ever
// saved) — every test that OPENS that modal needs this mock, same as
// `use-progress-mutations.test.tsx`'s own `viewerBootstrapMock`. Module
// scope, not inside `describe('set progress')`: the lazy-split tests below
// open the same modal for a different reason.
const viewerBootstrapMock = (): MockedResponse => ({
  request: { query: ViewerBootstrapDocument },
  result: {
    data: {
      __typename: 'Query',
      viewer: {
        __typename: 'Viewer',
        username: 'le',
        isAdmin: false,
        mustChangePassword: false,
        user: { __typename: 'User', id: VIEWER_USER_ID },
        library: { __typename: 'Library', id: LIBRARY_ID },
      },
    },
  },
});

const notFoundMock = (): MockedResponse => ({
  request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  result: {
    data: {
      __typename: 'Query' as const,
      node: { __typename: 'Library' as const, id: LIBRARY_ID, book: null },
    },
  },
});

const errorMock = (): MockedResponse => ({
  request: { query: BookDetailDocument, variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID } },
  error: new Error('network down'),
});

// `ValidationDetailModal` only renders `SeverityCounts` at all when
// `messages.length > 0` — a non-empty `counts` list with an EMPTY
// `messages.edges` (i.e. what `counts` alone would suggest) still renders
// the "No validation issues found." empty state, since the modal's own
// branch is keyed on `messages`, not `counts`. So this default carries 3
// real WARNING messages alongside `counts: [{ severity: 'WARNING', count: 3
// }]`, matching what a real payload would look like.
const warningMessageEdge = (seq: number) => ({
  __typename: 'ValidationMessagesConnectionEdge' as const,
  node: {
    __typename: 'ValidationMessage' as const,
    seq,
    severity: 'WARNING' as const,
    message: `warning message ${seq}`,
    code: `CSS-00${seq}`,
    path: null,
    line: null,
    column: null,
    segments: [
      { __typename: 'MessageSegment' as const, text: `warning message ${seq}`, subject: false },
    ],
  },
});

// A message whose `segments` (task 12b) include a genuine subject run — used
// to prove `toValidationMessages` threads the real server split through to
// the modal, rather than the modal's own `?? [{ text: m.message }]` fallback
// (which `validation-detail-modal/index.test.tsx` already covers directly,
// via hand-built props, not a GraphQL round trip).
const subjectMessageEdge = {
  __typename: 'ValidationMessagesConnectionEdge' as const,
  node: {
    __typename: 'ValidationMessage' as const,
    seq: 0,
    severity: 'ERROR' as const,
    message: 'Referenced resource "text/001-ch1.xhtml#pg-11" could not be found.',
    code: 'RSC-007',
    path: null,
    line: null,
    column: null,
    segments: [
      { __typename: 'MessageSegment' as const, text: 'Referenced resource ', subject: false },
      {
        __typename: 'MessageSegment' as const,
        text: 'text/001-ch1.xhtml#pg-11',
        subject: true,
      },
      { __typename: 'MessageSegment' as const, text: ' could not be found.', subject: false },
    ],
  },
};

const validateMutationMock = (overrides: Record<string, unknown> = {}): MockedResponse => ({
  request: { query: BookValidateDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      bookValidate: {
        __typename: 'BookValidatePayload' as const,
        book: { __typename: 'Book' as const, id: BOOK_ID },
        validation: {
          __typename: 'Validation' as const,
          id: BOOK_ID,
          valid: false,
          threshold: 'ERROR' as const,
          validatedAt: '2026-08-13T00:00:00.000Z',
          counts: [
            {
              __typename: 'ValidationSeverityCount' as const,
              severity: 'WARNING' as const,
              count: 3,
            },
          ],
          messages: {
            __typename: 'ValidationMessagesConnection' as const,
            edges: [1, 2, 3].map(warningMessageEdge),
          },
          ...overrides,
        },
      },
    },
  },
});

const validateMutationFailureMock = (): MockedResponse => ({
  request: { query: BookValidateDocument, variables: { id: BOOK_ID } },
  result: { data: { __typename: 'Mutation' as const, bookValidate: null } },
});

async function renderPage(
  mocks: MockedResponse[],
  options: Partial<Parameters<typeof renderWithApollo>[1]> = {}
) {
  const { BookPage } = await import('./index');
  return renderWithApollo(<BookPage />, { ...options, mocks });
}

// `PageActionsMenu` (`~/control/page-actions-menu`) always renders an "all
// items" mobile menu behind a "More actions" trigger, alongside
// `PageActionsBar`'s own desktop overflow trigger sharing the SAME
// accessible name — see `component/page/index.test.tsx`'s own
// `getAllByRole('button', { name: 'More actions' })`. `[0]` is deterministic
// (`PageActionsMenu` renders first in `Page`'s own JSX), and its
// `ActionMenuList` carries the FULL `headerActions` list — every non-primary
// item (`Validate`, `Upload and replace`, `Book lineage`, ...) is a
// `role="menuitem"` button hidden behind it until opened, not a plain
// `role="button"` — the brief's own `getByRole('button', ...)` guesses for
// these are wrong on both the role AND (for "Upload replacement") the label;
// verified instead against `page/book/actions.ts`.
async function selectMenuItem(name: RegExp) {
  const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

/**
 * Cache seeding + mocks for the four book mutations this page owns since
 * Task 8 inlined them here (`use-delete-book`, `use-regen-chapters`,
 * `use-clear-book-editions`, `use-validate-book` all dissolved into
 * `./index.tsx`). The `update` functions they carry are the reason these
 * assertions read the CACHE rather than a call count.
 */
type PageClient = Awaited<ReturnType<typeof renderPage>>['client'];

const ENTRIES_VARS = { libraryId: LIBRARY_ID, first: 20, filter: undefined };

/**
 * `LibraryEntriesDocument` is loaded DYNAMICALLY, not with a top-level
 * `import … from '~/page/library'`. This file carries a
 * `vi.mock('~/control', importOriginal)`, and `~/page/library` pulls the
 * `~/component` barrel into the same ~70-cycle import graph the standing
 * note in `src/test-utils.tsx` documents — a static import here made
 * `UploadReplaceModal` resolve to `undefined` and silently broke an
 * unrelated, previously green test ("passes the book GLOBAL id to the
 * replace modal"). Deferring the import until after the page has already
 * rendered keeps the real document (which is what gives these cache
 * assertions their teeth) without re-entering the cycle during module init.
 */
const libraryEntriesDocument = async () => (await import('~/page/library')).LibraryEntriesDocument;

// Deliberately UNANNOTATED: `LibraryEntriesQuery`'s `node` member is masked,
// so a literal under an explicit annotation would fail the excess-property
// check. Passing it through as a non-literal sidesteps that.
const standaloneRow = (id: string) => ({
  __typename: 'Book' as const,
  id,
  title: 'A Wizard of Earthsea',
  author: 'Le Guin',
  seriesIndex: 0,
  hasCover: false,
  thumbnailUrl: '',
  progress: null,
});

// The server deletes a series when its LAST book goes with it, but
// `BookDeletePayload` carries no `deletedSeriesId` — the client has nothing
// to evict the `Series` entity with. This row shape is what forces the
// `update` to invalidate the WHOLE `entries` field rather than only the
// deleted `Book`.
const soloSeriesRow = () => ({
  __typename: 'Series' as const,
  id: 'series-1',
  name: 'Solo Series',
  author: 'A',
  bookCount: 1,
  progressPercentage: 0,
  books: {
    __typename: 'BookConnection' as const,
    edges: [
      {
        __typename: 'BookEdge' as const,
        node: {
          __typename: 'Book' as const,
          id: BOOK_ID,
          title: 'Only Book',
          hasCover: false,
          mtime: '',
          thumbnailUrl: '',
        },
      },
    ],
  },
});

const seedLibraryEntries = async (client: PageClient, nodes: ReturnType<typeof standaloneRow>[]) =>
  client.writeQuery({
    query: await libraryEntriesDocument(),
    variables: ENTRIES_VARS,
    data: {
      __typename: 'Query',
      node: {
        __typename: 'Library',
        id: LIBRARY_ID,
        entries: {
          __typename: 'LibraryEntriesConnection',
          edges: nodes.map((node, i) => ({
            __typename: 'LibraryEntriesConnectionEdge' as const,
            cursor: `c${i}`,
            node,
          })),
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
        },
      },
    },
  });

const readEntries = async (client: PageClient) =>
  client.cache.readQuery({ query: await libraryEntriesDocument(), variables: ENTRIES_VARS });

const deleteSuccessMock = (): MockedResponse => ({
  request: { query: BookDeleteDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      bookDelete: {
        __typename: 'BookDeletePayload' as const,
        deletedId: BOOK_ID,
        library: { __typename: 'Library' as const, id: LIBRARY_ID },
      },
    },
  },
});

const NEW_BOOK_ID = 'Qm9vazoy'; // Book:2 — the id a regen can rotate INTO

const regenMock = (responseId: string, extra: Partial<MockedResponse> = {}): MockedResponse => ({
  request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      bookRegenChapters: {
        __typename: 'BookRegenChaptersPayload' as const,
        book: {
          __typename: 'Book' as const,
          id: responseId,
          chapterCount: 5,
          chapterNames: ['One', 'Two'],
          chapterSpineMap: [0, 10],
        },
      },
    },
  },
  ...extra,
});

const regenErrorMemberMock = (typename: string, message: string): MockedResponse => ({
  request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      bookRegenChapters: { __typename: typename, message },
    },
  },
});

const clearEditionsMock = (
  clearedCount: number,
  deviceEditionCount = 0,
  extra: Partial<MockedResponse> = {}
): MockedResponse => ({
  request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
  result: {
    data: {
      __typename: 'Mutation' as const,
      bookClearEditions: {
        __typename: 'BookClearEditionsPayload' as const,
        clearedCount,
        book: { __typename: 'Book' as const, id: BOOK_ID, deviceEditionCount },
      },
    },
  },
  ...extra,
});

/** Counts every `BookValidation` operation at REQUEST time (see the lazy-split
 * note above for why the variable matcher, not `result`, is the counter). */
const validationReadCounter = { requests: 0 };
const validationReadMock = (): MockedResponse => ({
  request: {
    query: BookValidationDocument,
    variables: function bookValidationVariables(vars) {
      validationReadCounter.requests += 1;
      return vars.libraryId === LIBRARY_ID && vars.bookId === BOOK_ID;
    },
  },
  maxUsageCount: Infinity,
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
            valid: true,
            threshold: 'ERROR' as const,
            validatedAt: '2026-08-13T00:00:00.000Z',
            counts: [],
            messages: { __typename: 'ValidationMessagesConnection' as const, edges: [] },
          },
        },
      },
    },
  },
});

async function openBookAnd(mocks: MockedResponse[], item: RegExp) {
  const rendered = await renderPage(mocks);
  await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
  await selectMenuItem(item);
  return rendered;
}

describe('BookPage', () => {
  it('shows a loading state while the book is still resolving', async () => {
    await renderPage([]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows "Book not found." for a null book', async () => {
    await renderPage([notFoundMock()]);
    expect(await screen.findByText('Book not found.')).toBeInTheDocument();
  });

  // Same OR-ing bug `page/series` was reviewed and fixed for: a transport
  // failure also leaves `book` `undefined`, and folding it into the
  // not-found branch would misreport a network failure as the book
  // genuinely not existing.
  it('shows a distinct message on a transport failure, not "Book not found."', async () => {
    await renderPage([errorMock()]);
    expect(await screen.findByText('Failed to load book.')).toBeInTheDocument();
    expect(screen.queryByText('Book not found.')).not.toBeInTheDocument();
  });

  it('renders the cover from Book.coverUrl, not a hand-built URL', async () => {
    await renderPage([bookMock()]);

    const img = await screen.findByAltText('A Wizard of Earthsea');
    // `useAuthorizedSrc` turns it into a `blob:` URL — assert on what it was
    // ASKED to authorize (`apiFetch`'s argument), the same convention
    // `from-entry.test.tsx` uses.
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/books/1/cover?user=le&v=1')
    );
    expect(img).toBeInTheDocument();
  });

  // `Button` (`~/control/button`) renders a `<div role="button">` with
  // `aria-disabled`, not a native `<button disabled>` — jest-dom's
  // `toBeDisabled`/`toBeEnabled` only recognize the latter, so this asserts
  // on `aria-disabled` directly, the same convention `page/upload` and
  // `component/upload-item`'s own tests use for this same component.
  it('blocks editing when the book has never been validated (validation: null)', async () => {
    await renderPage([bookMock({ validation: null })]);

    await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
    expect(screen.getByRole('button', { name: /edit metadata/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('blocks editing when validation.valid is false', async () => {
    await renderPage([bookMock({ validation: { ...validationFixture, valid: false } })]);

    await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
    expect(screen.getByRole('button', { name: /edit metadata/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('allows editing when validation.valid is true', async () => {
    await renderPage([bookMock()]);

    await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
    expect(screen.getByRole('button', { name: /edit metadata/i })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('navigates back to the series using Book.series.name', async () => {
    await renderPage([bookMock()]);

    // `/\(Earthsea/` — not `/Earthsea/` — because the title itself ("A
    // Wizard of Earthsea") also matches the looser pattern.
    await userEvent.click(await screen.findByText(/\(Earthsea/));
    expect(routerMocks.navigate).toHaveBeenCalledWith('/library/series/Earthsea');
  });

  it('falls back to the library when the book has no series', async () => {
    await renderPage([bookMock({ series: null })]);

    await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
    expect(screen.queryByText(/\(Earthsea/)).not.toBeInTheDocument();
  });

  it('passes the book GLOBAL id to the replace modal', async () => {
    await renderPage([bookMock()]);

    await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
    await selectMenuItem(/^upload and replace$/i);

    expect(replaceModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: BOOK_ID }),
      undefined
    );
  });

  describe('validate', () => {
    it('opens the validation modal with counts converted from the list shape', async () => {
      await renderPage([bookMock(), validateMutationMock()]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^validate$/i);

      // The modal takes `Record<Severity, number>`; the fragment gives a
      // list — this is a cache-hit read through `BookValidationDocument`, proved
      // below by there being no `BookValidationDocument` mock at all: an
      // empty `MockLink` throws on any unmatched operation, so reaching this
      // assertion IS the proof no round trip occurred.
      await waitFor(() => expect(screen.getByText(/3 warning/i)).toBeInTheDocument());
    });

    // I-2 (2026-08-13 final review): `ValidationDetailModal`'s DEFAULT intro
    // ("...must be fixed before this EPUB can be uploaded") is upload-flow
    // copy — false here, since this book is already in the library. A prior
    // rewrite dropped the book-specific `intro` this page used to pass.
    it('shows book-specific validation copy, not the upload-flow default', async () => {
      await renderPage([bookMock(), validateMutationMock()]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^validate$/i);

      await waitFor(() =>
        expect(screen.getByText(/epubcheck results for this book/i)).toBeInTheDocument()
      );
      expect(screen.queryByText(/can be uploaded/i)).not.toBeInTheDocument();
    });

    it('shows a clean pass with no messages distinctly from a fail with messages', async () => {
      // Closes the debt this task was scoped around: previously ANY
      // successful mutation toasted the SAME "Validation complete" message
      // regardless of `validation.valid` — a failing book looked identical
      // to a passing one. Now the modal itself renders the real outcome.
      await renderPage([
        bookMock(),
        validateMutationMock({
          valid: true,
          counts: [],
          messages: { __typename: 'ValidationMessagesConnection' as const, edges: [] },
        }),
      ]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^validate$/i);

      expect(await screen.findByText(/no validation issues found/i)).toBeInTheDocument();
    });

    // Task 12b: `ValidationFragment` now selects `segments`, and
    // `toValidationMessages` threads them through — this is the fallback
    // (`m.segments ?? [{ text: m.message }]`) NO LONGER being the live path
    // for a real server payload. A fixture with `segments: undefined` would
    // throw here (`node.segments.map` on `undefined`), so reaching the
    // assertion also proves the mock itself carries the field.
    it('renders a quoted subject run monospaced, from real server segments', async () => {
      await renderPage([
        bookMock(),
        validateMutationMock({
          counts: [{ __typename: 'ValidationSeverityCount' as const, severity: 'ERROR', count: 1 }],
          messages: {
            __typename: 'ValidationMessagesConnection' as const,
            edges: [subjectMessageEdge],
          },
        }),
      ]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^validate$/i);

      const subject = await screen.findByText('text/001-ch1.xhtml#pg-11');
      expect(subject.tagName).toBe('CODE');
      // the quotes are dropped from the rendered output
      expect(screen.queryByText(/"text\//)).not.toBeInTheDocument();
      expect(screen.getByText(/Referenced resource/)).toBeInTheDocument();
    });

    it('toasts an error and does not open the modal when the mutation fails', async () => {
      await renderPage([bookMock(), validateMutationFailureMock()]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^validate$/i);

      expect(await screen.findByText('Validation failed')).toBeInTheDocument();
      expect(screen.queryByText(/no validation issues found/i)).not.toBeInTheDocument();
    });
  });

  describe('lineage', () => {
    it('renders real lineage history, not an empty list', async () => {
      const { client } = await renderPage([
        bookMock(),
        lineageMock([rawLineageEntry({ oldId: 'doc-old-hash', newId: 'doc-current-hash' })]),
      ]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^book lineage$/i);

      // A real entry from `Book.lineage`, not the empty-list shim task 10 left.
      expect(await screen.findByText('doc-current-hash')).toBeInTheDocument();
      expect(screen.getByText('doc-old-hash')).toBeInTheDocument();

      // `lineage` stays MASKED on the way out of the query — carried over
      // from the deleted `use-book-detail.test.tsx`, which held the only
      // checked-in assertion of this (review round 1, Item 5). Masking is
      // COMPILE-time only, so it is proved at the type level rather than by
      // asserting a missing runtime property: `@ts-expect-error` is itself
      // an error if the expression type-checks, so `tsc --noEmit` (part of
      // `npm run lint`) fails the moment `lineage` stops being masked.
      const cached = client.cache.readQuery({
        query: BookLineageDocument,
        variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
      });
      const refs = cached?.node?.__typename === 'Library' ? cached.node.book?.lineage : undefined;
      // Positive control: without this the `@ts-expect-error` below could sit
      // on an expression that is `undefined` for an unrelated reason.
      expect(refs).toHaveLength(1);
      // @ts-expect-error — `timestamp` is masked behind LineageEntryFragment
      void refs?.[0]?.timestamp;
    });

    it("shows the book's RAW documentId as the current row when lineage is empty, never the GLOBAL id", async () => {
      await renderPage([bookMock(), lineageMock([])]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^book lineage$/i);

      // Proves the `bookId`/`documentId` prop split (2026-08-13 review): the
      // modal's display fallback is `book.documentId` (a raw content hash),
      // never `book.id` (the Relay global id `bookUnlinkDocument` needs).
      expect(await screen.findByText(DOCUMENT_ID)).toBeInTheDocument();
      expect(screen.queryByText(BOOK_ID)).not.toBeInTheDocument();
    });
  });

  /**
   * The lazy splits (2026-08-26) — this project's headline deliverable, and
   * the reason the whole task exists. Colocation alone is cost-neutral; the
   * saving comes from `BookDetail` no longer carrying fields that only a
   * modal reads, and these tests are what stop a split from silently
   * regressing back to eager.
   *
   * The "does NOT fire" halves are load-bearing, not decoration: without
   * them a split that accidentally stayed eager passes every other test in
   * this file. See `chaptersMock`'s own comment for why the request COUNTER
   * (incremented by `MockLink` at match time) is the assertion that fails
   * closed here, rather than a cache read or a wait-and-see.
   */
  describe('lazy splits', () => {
    it('does not fetch chapters until the progress modal opens', async () => {
      // The chapters mock IS supplied — so this is not "nothing fetched
      // because nothing could". If `chapterNames`/`chapterSpineMap` were
      // still selected eagerly (or the split's `skip` gate were wrong),
      // `BookChapters` would match this mock during mount and the counter
      // would be 1 by the time the heading renders.
      await renderPage([bookMock(), chaptersMock()]);

      // The page renders in FULL off `BookDetail` alone — header actions,
      // metadata, subjects — with no chapters round trip behind it.
      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      expect(screen.getByText('12')).toBeInTheDocument(); // the chapterCount metadata row
      expect(screen.getByRole('button', { name: /edit metadata/i })).toBeInTheDocument();
      expect(chapterCounter.requests).toBe(0);
    });

    it('fetches chapters when the progress modal opens', async () => {
      await renderPage([bookMock(), viewerBootstrapMock(), chaptersMock()], {
        user: { username: 'le', isAdmin: false },
      });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      expect(chapterCounter.requests).toBe(0);

      await selectMenuItem(/^set progress$/i);

      await waitFor(() => expect(chapterCounter.requests).toBe(1));
      // Not just "a request happened" — the fetched names actually reach the
      // modal. The fixture's `progress.currentChapter: 3` is the modal's
      // `initialChapter`, so it renders `chapterNames[2]`; a modal still
      // reading a (now absent) eager `book.chapterNames` would render the
      // empty-string fallback instead.
      expect(await screen.findByText('The School for Wizards')).toBeInTheDocument();
    });

    it('does not fetch lineage until the lineage modal opens', async () => {
      await renderPage([bookMock(), lineageMock([rawLineageEntry()])]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      expect(lineageCounter.requests).toBe(0);

      await selectMenuItem(/^book lineage$/i);

      await waitFor(() => expect(lineageCounter.requests).toBe(1));
      expect(await screen.findByText('doc-current-hash')).toBeInTheDocument();
    });

    it('prefetches chapters on hover of the Set progress action', async () => {
      await renderPage([bookMock(), chaptersMock()]);
      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });

      const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
      await userEvent.click(trigger);
      const setProgress = await screen.findByRole('menuitem', { name: /^set progress$/i });
      expect(chapterCounter.requests).toBe(0);

      await userEvent.hover(setProgress);

      await waitFor(() => expect(chapterCounter.requests).toBe(1));
      // Intent alone did it — the modal was never opened, so this cannot be
      // the modal's own `useQuery` firing under another name. ('Set
      // Progress' with a capital P is the modal HEADER; the menu item this
      // test hovers is 'Set progress'.)
      expect(screen.queryByText('Set Progress')).not.toBeInTheDocument();
    });

    /**
     * The lineage half of the same wiring (review round 1, Item 3). Its
     * absence was invisible before: "does not fetch lineage until the
     * lineage modal opens" uses `selectMenuItem`, which goes through
     * `userEvent.click` — and click dispatches `mouseenter` FIRST, so the
     * count reaches 1 through either path and deleting
     * `onShowLineageIntent` left every test green.
     *
     * `userEvent.hover` with no click is what separates them.
     */
    it('prefetches lineage on hover of the Book lineage action', async () => {
      await renderPage([bookMock(), lineageMock([rawLineageEntry()])]);
      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });

      const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
      await userEvent.click(trigger);
      const bookLineage = await screen.findByRole('menuitem', { name: /^book lineage$/i });
      expect(lineageCounter.requests).toBe(0);

      await userEvent.hover(bookLineage);

      await waitFor(() => expect(lineageCounter.requests).toBe(1));
      // Matched on the modal's INTRO copy, not its 'Book lineage' header —
      // the menu item this test hovered carries that same text.
      expect(screen.queryByText(/Editing or re-importing a book changes its ID/i)).toBeNull();
    });
  });

  /**
   * Review round 1, Item 2. The split moved `lineage`/`chapterNames` behind
   * their own documents and defaulted them (`?? []`) at the call site, which
   * turns a FAILED read into a plausible-looking answer rather than a
   * visible failure. These pin the two apart.
   */
  describe('a failed lazy read is not reported as an empty one', () => {
    it('shows a lineage failure distinctly from an empty lineage', async () => {
      await renderPage([bookMock(), lineageErrorMock()]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^book lineage$/i);

      expect(await screen.findByText(/not the same as having none/i)).toBeInTheDocument();
      // The EMPTY-lineage presentation is a single current row rendering the
      // book's own `documentId` (pinned by the test above it). Its absence
      // here is the actual finding: a failed read no longer claims the book
      // has no edit history.
      expect(screen.queryByText(DOCUMENT_ID)).not.toBeInTheDocument();
    });

    it('flags a chapters failure without blocking the save', async () => {
      await renderPage([bookMock(), viewerBootstrapMock(), chaptersErrorMock()], {
        user: { username: 'le', isAdmin: false },
      });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^set progress$/i);

      const header = await screen.findByText('Set Progress');
      const modal = within(header.closest('dialog') as HTMLElement);
      expect(await screen.findByText(/progress can still be saved/i)).toBeInTheDocument();
      // Non-blocking by design: `percentage` derives from `chapterCount`,
      // which stays EAGER on `BookDetail`, so a failed chapters read must
      // not disable Save. `Button` renders `aria-disabled`, not the native
      // attribute (see this file's own note on `edit metadata`).
      expect(modal.getByRole('button', { name: /save/i, hidden: true })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      );
    });
  });

  /**
   * Review round 1, Item 1. `useCurrentLibraryId` learns its `libraryId`
   * from a NETWORK query (`ViewerBootstrap`), so it is `undefined` for the
   * whole round trip on a cold load — and an admin with no library selected
   * holds it `undefined` indefinitely. Both of `page/book`'s responses to
   * that (`skip`, and folding `libraryIdLoading` into `loading`) were
   * unreachable from this file until the stub above was made mutable; the
   * deleted `use-book-detail.test.tsx` had been carrying them.
   */
  describe('library id gate', () => {
    it('issues no operation while there is no library id to root on', async () => {
      // Bootstrap DONE, still no library — an admin who has selected none.
      // Isolates the `skip` gate from the `loading` fold below.
      currentLibraryId = undefined;
      currentLibraryIdLoading = false;

      await renderPage([bookMock()]);

      expect(await screen.findByText('Book not found.')).toBeInTheDocument();
      // Counted at REQUEST time and count-FIRST, so a removed `skip` is
      // caught even though it would fire with `libraryId: ''` — variables
      // that match no mock.
      expect(bookDetailCounter.requests).toBe(0);
    });

    it('shows the loading state, not "Book not found.", while the library id is still resolving', async () => {
      currentLibraryId = undefined;
      currentLibraryIdLoading = true;

      await renderPage([bookMock()]);

      // A SKIPPED `useQuery` reports `loading: false` on its own, so without
      // the fold this renders "Book not found." for the whole bootstrap
      // round trip on every cold load.
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('Book not found.')).toBeNull();
      expect(screen.queryByText('Failed to load book.')).toBeNull();
    });
  });

  // Task 7 (teardown): `SetProgressModal` now writes/deletes progress
  // through `useSetMyProgress`/`useDeleteProgress` (GraphQL), and
  // `progressSet`'s payload normalizes onto the SAME `Progress` entity
  // `book.progress` reads off the Apollo cache — the STEP-8 BRIDGE
  // (`onSaved`/`refetch`) these tests used to exercise is gone, along with
  // `ProgressProvider`. These tests need a real, non-admin `username` —
  // unlike every other `renderPage` call above, which relies on
  // `renderWithProviders`' default anonymous user — because `isAdmin: true`
  // hides the "progress" metadata row/`progressbar` entirely (`page/book`'s
  // own `if (!isAdmin)` gate), not because of anything progress-hook-
  // specific this time.
  describe('set progress', () => {
    const PROGRESS_ID = 'UHJvZ3Jlc3M6MQ=='; // Progress:1 — matches bookMock()'s default.

    // `progressSet`'s response re-selects the full `ProgressRowFragment` —
    // see `use-progress-mutations.ts`'s own doc comment for why that's what
    // lets Apollo's normalization alone update `book.progress` in place.
    const progressSetMock = (args: {
      currentChapter: number;
      percentage: number;
    }): MockedResponse => ({
      request: {
        query: ProgressSetDocument,
        variables: {
          input: {
            document: DOCUMENT_ID,
            userId: VIEWER_USER_ID,
            currentChapter: args.currentChapter,
            percentage: args.percentage,
          },
        },
      },
      result: {
        data: {
          __typename: 'Mutation',
          progressSet: {
            __typename: 'ProgressSetPayload',
            progress: {
              __typename: 'Progress',
              id: PROGRESS_ID,
              document: DOCUMENT_ID,
              percentage: args.percentage,
              currentChapter: args.currentChapter,
              device: 'Web',
              timestamp: '2026-08-23T00:00:00.000Z',
              book: {
                __typename: 'Book',
                id: BOOK_ID,
                title: 'A Wizard of Earthsea',
                author: 'Le Guin',
                hasCover: true,
                thumbnailUrl: '/api/books/1/cover?user=le&v=1',
              },
            },
            library: { __typename: 'Library', id: LIBRARY_ID },
            user: { __typename: 'User', id: VIEWER_USER_ID, progressCount: 1 },
          },
        },
      },
    });

    const progressDeleteMock = (): MockedResponse => ({
      request: { query: ProgressDeleteDocument, variables: { id: PROGRESS_ID } },
      result: {
        data: {
          __typename: 'Mutation',
          progressDelete: {
            __typename: 'ProgressDeletePayload',
            deletedId: PROGRESS_ID,
            library: { __typename: 'Library', id: LIBRARY_ID },
            user: { __typename: 'User', id: VIEWER_USER_ID, progressCount: 0 },
          },
        },
      },
    });

    // `SetProgressModal` is a real `<dialog>`; `showModal` is stubbed to a
    // no-op in `beforeAll` above (jsdom has no dialog rendering support), so
    // the element never gains the `open` attribute jsdom's own default
    // stylesheet keys `display` off of (`dialog:not([open]) { display: none;
    // }`). Plain `getByRole` filters that out by default — `hidden: true` is
    // this codebase's own convention for querying inside a real `<dialog>`
    // in tests (see `book-lineage-modal/index.test.tsx`,
    // `validation-detail-modal/index.test.tsx`). Scoped with `within`, not a
    // bare `screen.getByRole('button', { name: /cancel/i, hidden: true })`,
    // because `ConfirmModal` (delete / clear-editions) is ALSO always
    // mounted on this page as a real, permanently-hidden `<dialog>` with its
    // own "Cancel" button — an unscoped query throws "Found multiple
    // elements".
    async function getSetProgressDialog() {
      const header = await screen.findByText('Set Progress');
      return within(header.closest('dialog') as HTMLElement);
    }

    // Structural traversal down to `ProportionalChapterSlider`'s own pointer
    // target, mirroring `proportional-chapter-slider/index.test.tsx`'s own
    // `renderSlider` helper (that component exposes no accessible role).
    // `SetProgressModal`'s dialog body is, in order:
    // header / chapterDisplay / sliderSection / (error?) / footer — index 2
    // is `sliderSection` whenever `hasError` is false, which it always is
    // the first time a dialog opens in these tests.
    async function getSliderRoot() {
      const header = await screen.findByText('Set Progress');
      const dialogInner = header.parentElement as HTMLElement;
      const sliderSection = dialogInner.children[2] as HTMLElement;
      const sliderWrapper = sliderSection.firstElementChild as HTMLElement;
      const sliderRoot = sliderWrapper.firstElementChild as HTMLElement;
      const track = sliderRoot.firstElementChild as HTMLElement;
      Object.defineProperty(track, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, width: 100 }) as DOMRect,
      });
      return sliderRoot;
    }

    // Step 7's bridge-removal proof: ONE `BookDetail` mock only — a refetch
    // would be a SECOND `BookDetail` operation with no matching mock left,
    // which `MockLink` (`showWarnings` left on by `renderWithApollo`) would
    // error as "No more mocked responses". The percentage must instead
    // update from `progressSet`'s own payload normalizing onto the SAME
    // `Progress:<id>` entity `book.progress` reads — that is what replaced
    // `onSaved`/`refetch`. Clicking Save without touching the slider re-saves
    // the CURRENT chapter (3 of 12 = 0.25), a different percentage than the
    // fixture's 0.2, so a stale display is distinguishable from a live one.
    it('updates the displayed percentage after a save, with no refetch', async () => {
      const { client } = await renderPage(
        [
          bookMock(),
          viewerBootstrapMock(),
          chaptersMock(),
          progressSetMock({ currentChapter: 3, percentage: 0.25 }),
        ],
        { user: { username: 'le', isAdmin: false } }
      );

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

      await selectMenuItem(/^set progress$/i);
      const modal = await getSetProgressDialog();
      // `useSetMyProgress` reads `userId` off `ViewerBootstrapDocument`; wait
      // for that query to land before Save, or `setProgress` takes its
      // "not signed in" branch and never calls the mutation at all — the
      // same wait `use-progress-mutations.test.tsx`'s own
      // `waitForViewerBootstrap` performs.
      await waitFor(() =>
        expect(client.cache.readQuery({ query: ViewerBootstrapDocument })).not.toBeNull()
      );
      await userEvent.click(modal.getByRole('button', { name: /save/i, hidden: true }));

      await waitFor(() =>
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
      );
    });

    it('does not call the mutation when the modal is dismissed without saving', async () => {
      // No `ProgressSetDocument`/`ProgressDeleteDocument` mock supplied — if
      // Cancel fired either, `MockLink` would error that operation with "No
      // more mocked responses" instead. The assertions below (the
      // progressbar unchanged, the heading still present) are the actual
      // check that nothing broke as a side effect.
      await renderPage([bookMock(), viewerBootstrapMock(), chaptersMock()], {
        user: { username: 'le', isAdmin: false },
      });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^set progress$/i);
      const modal = await getSetProgressDialog();
      await userEvent.click(modal.getByRole('button', { name: /cancel/i, hidden: true }));

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
      expect(screen.getByRole('heading', { name: 'A Wizard of Earthsea' })).toBeInTheDocument();
    });

    // `SetProgressModal` now gets `progressId` from `book.progress?.id` (the
    // Relay global `Progress.id`) — never `documentId` (the raw content
    // hash `progressSet` takes) or `Book.id` (the Relay global id for a
    // DIFFERENT entity). `progressDeleteMock`'s `request.variables.id` is
    // pinned to `PROGRESS_ID`; if the modal sent either of the other two
    // instead, `MockLink` would find no matching mock and error the
    // mutation, and the modal would never close. The final `waitFor` below
    // is that proof — the same "closes on a clean delete = used a
    // resolvable id" shape the pre-migration REST version of this test used.
    it('issues progressDelete against the Progress global id, never documentId or the Book global id', async () => {
      await renderPage([bookMock(), viewerBootstrapMock(), chaptersMock(), progressDeleteMock()], {
        user: { username: 'le', isAdmin: false },
      });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^set progress$/i);
      const modal = await getSetProgressDialog();

      // Drag the slider to the leftmost position (chapter 0) to surface
      // "Clear Progress" — the fixture's `progress.currentChapter: 3` makes
      // `hasExistingProgress` true, so this is reachable without a prior save.
      const sliderRoot = await getSliderRoot();
      fireEvent.pointerDown(sliderRoot, { clientX: 0, pointerId: 1 });
      fireEvent.pointerUp(sliderRoot, { clientX: 0, pointerId: 1 });

      await userEvent.click(modal.getByRole('button', { name: /clear progress/i, hidden: true }));

      await waitFor(() => expect(screen.queryByText('Set Progress')).not.toBeInTheDocument());
      // `useDeleteProgress` evicts `Progress:<id>` from the cache, which
      // would otherwise leave `Book.progress` a dangling reference —
      // confirms that does NOT sour the surrounding page read (no fallback
      // to "Failed to load book.") and that the indicator visibly reflects
      // the clear (`ProgressIndicator` renders no `progressbar` role at all
      // at 0%, only "Not started" text), not just that the mutation itself
      // succeeded.
      expect(screen.getByRole('heading', { name: 'A Wizard of Earthsea' })).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(screen.getByText('Not started')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // The four mutations this page owns since Task 8. Every behaviour below was
  // pinned by a deleted `provider/book/hook/*.test.tsx`; each is now driven
  // through the real header action that triggers it.
  // -------------------------------------------------------------------------

  describe('delete', () => {
    const confirmDelete = async () =>
      userEvent.click(await screen.findByRole('button', { name: 'Delete', hidden: true }));

    it('evicts the deleted book from the cache', async () => {
      const { client } = await openBookAnd([bookMock(), deleteSuccessMock()], /^delete$/i);
      expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`]).toBeDefined();

      await confirmDelete();

      await waitFor(() =>
        expect(Object.keys(client.cache.extract() as NormalizedCacheObject)).not.toContain(
          `Book:${BOOK_ID}`
        )
      );
    });

    // A standalone book's own edge would self-heal from `Book` eviction alone,
    // so asserting `null` — not "the other row survives" — is what pins the
    // UNCONDITIONAL field eviction the payload gives no way to scope.
    it('invalidates the LibraryEntries connection so a subsequent read misses the cache (standalone book)', async () => {
      const { client } = await openBookAnd([bookMock(), deleteSuccessMock()], /^delete$/i);
      await seedLibraryEntries(client, [standaloneRow(BOOK_ID), standaloneRow('Qm9vazoz')]);
      expect(await readEntries(client)).not.toBeNull();

      await confirmDelete();

      await waitFor(async () => expect(await readEntries(client)).toBeNull());
    });

    it("removes an emptied series' row from a subsequent LibraryEntries cache read", async () => {
      const { client } = await openBookAnd([bookMock(), deleteSuccessMock()], /^delete$/i);
      await seedLibraryEntries(client, [
        soloSeriesRow() as unknown as ReturnType<typeof standaloneRow>,
      ]);
      expect(await readEntries(client)).not.toBeNull();

      await confirmDelete();

      // The stale `Series` row cannot "disappear" from a cache the client
      // never re-fetches: this asserts the connection was INVALIDATED, so the
      // next read is forced to the network.
      await waitFor(async () => expect(await readEntries(client)).toBeNull());
    });

    it('toasts the transport error message when the mutation throws', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookDeleteDocument, variables: { id: BOOK_ID } },
            error: new Error('Network error'),
          },
        ],
        /^delete$/i
      );

      await confirmDelete();

      expect(await screen.findByText('Network error')).toBeInTheDocument();
    });

    it('toasts a generic failure when the mutation resolves missing', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookDeleteDocument, variables: { id: BOOK_ID } },
            result: { data: { __typename: 'Mutation' as const, bookDelete: null } },
          },
        ],
        /^delete$/i
      );

      await confirmDelete();

      expect(await screen.findByText('Failed to delete book')).toBeInTheDocument();
    });
  });

  describe('regen chapters', () => {
    it('updates chapter fields on the same Book entity via normalization when the id is unchanged', async () => {
      const { client } = await openBookAnd([bookMock(), regenMock(BOOK_ID)], /^regen chapters$/i);

      await waitFor(() => {
        const entity = (client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`] as {
          chapterCount: number;
        };
        expect(entity.chapterCount).toBe(5);
      });
    });

    // `reimportBook` recomputes the content hash, which is the raw local half
    // of the Book's global id — so a regen can MINT A NEW ID. Normalization
    // alone would write `Book:<new-id>` and leave the pre-regen entity, with
    // its stale chapter data, in the cache forever.
    it('evicts the old Book entity when the payload reports a different id (hash changed)', async () => {
      const { client } = await openBookAnd(
        [bookMock(), regenMock(NEW_BOOK_ID)],
        /^regen chapters$/i
      );
      expect((client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`]).toBeDefined();

      await waitFor(() => {
        const extracted = client.cache.extract() as NormalizedCacheObject;
        expect(Object.keys(extracted)).not.toContain(`Book:${BOOK_ID}`);
        expect((extracted[`Book:${NEW_BOOK_ID}`] as { chapterCount: number }).chapterCount).toBe(5);
      });
    });

    it('toasts a BookHashCollisionError message', async () => {
      await openBookAnd(
        [
          bookMock(),
          regenErrorMemberMock(
            'BookHashCollisionError',
            'This book collides with another book already in the library.'
          ),
        ],
        /^regen chapters$/i
      );

      expect(
        await screen.findByText('This book collides with another book already in the library.')
      ).toBeInTheDocument();
    });

    it('toasts a BookNotValidatedError message', async () => {
      await openBookAnd(
        [
          bookMock(),
          regenErrorMemberMock(
            'BookNotValidatedError',
            'This book must pass validation before it can be edited.'
          ),
        ],
        /^regen chapters$/i
      );

      expect(
        await screen.findByText('This book must pass validation before it can be edited.')
      ).toBeInTheDocument();
    });

    it('toasts a generic failure when the mutation resolves missing', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
            result: { data: { __typename: 'Mutation' as const, bookRegenChapters: null } },
          },
        ],
        /^regen chapters$/i
      );

      expect(await screen.findByText('Failed to regenerate chapters')).toBeInTheDocument();
    });

    it('toasts the transport error message when the mutation throws', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookRegenChaptersDocument, variables: { id: BOOK_ID } },
            error: new Error('Network error'),
          },
        ],
        /^regen chapters$/i
      );

      expect(await screen.findByText('Network error')).toBeInTheDocument();
    });

    // The in-flight flag, pinned through the action it actually drives. The
    // mock NEVER resolves within the test, so the assertion needs no tuned
    // wait: if `regenLoading` were dropped, the item would be enabled the
    // instant the menu re-opens and this fails immediately.
    it('disables Regen chapters while a regen is still in flight', async () => {
      await openBookAnd([bookMock(), regenMock(BOOK_ID, { delay: 100_000 })], /^regen chapters$/i);

      const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
      await userEvent.click(trigger);
      const item = await screen.findByRole('menuitem', { name: /^regen chapters$/i });
      // `ActionMenuList` renders a native `<button disabled>` for a disabled
      // item, so this is the DOM property, not an ARIA attribute.
      expect(item).toBeDisabled();
    });
  });

  describe('clear device editions', () => {
    const confirmClear = async () =>
      userEvent.click(await screen.findByRole('button', { name: 'Clear editions', hidden: true }));

    // No hand-written `update` exists for this mutation: the payload
    // re-selects `book { id deviceEditionCount }` and Apollo's normalization
    // writes the new count onto the existing entity. This is the proof,
    // asserted against the CACHE — the fixture seeds `deviceEditionCount: 2`.
    it('zeroes deviceEditionCount in the cache with no hand-written update', async () => {
      const { client } = await openBookAnd(
        [bookMock(), clearEditionsMock(2, 0)],
        /^clear device editions/i
      );
      expect(
        (
          (client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`] as {
            deviceEditionCount: number;
          }
        ).deviceEditionCount
      ).toBe(2);

      await confirmClear();

      await waitFor(() =>
        expect(
          (
            (client.cache.extract() as NormalizedCacheObject)[`Book:${BOOK_ID}`] as {
              deviceEditionCount: number;
            }
          ).deviceEditionCount
        ).toBe(0)
      );
    });

    it('toasts the cleared count on success', async () => {
      await openBookAnd([bookMock(), clearEditionsMock(3, 0)], /^clear device editions/i);
      await confirmClear();

      expect(await screen.findByText('Cleared 3 device editions')).toBeInTheDocument();
    });

    it('toasts a generic failure when the mutation resolves missing', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
            result: { data: { __typename: 'Mutation' as const, bookClearEditions: null } },
          },
        ],
        /^clear device editions/i
      );
      await confirmClear();

      expect(await screen.findByText('Failed to clear device editions')).toBeInTheDocument();
    });

    it('toasts the transport error message when the mutation throws', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookClearEditionsDocument, variables: { id: BOOK_ID } },
            error: new Error('Network error'),
          },
        ],
        /^clear device editions/i
      );
      await confirmClear();

      expect(await screen.findByText('Network error')).toBeInTheDocument();
    });
  });

  describe('the lazy validation read', () => {
    // The whole reason the 2026-08-13 split exists. Counted at REQUEST time
    // (see the lazy-split note above), so an eagerly-issued read increments
    // before the page's first `await` resolves and this fails CLOSED.
    it('issues no BookValidation operation until Validate is used', async () => {
      await renderPage([bookMock(), validationReadMock()]);
      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });

      expect(validationReadCounter.requests).toBe(0);
    });

    // `bookValidate`'s payload carries `validation` as a TOP-LEVEL field, not
    // nested under `book`. It only lands on the Book's own cached
    // `validation` because `Validation.id` IS the owning Book's global id, so
    // every read of `Book.validation` resolves to the same entity. No
    // hand-written `update` exists; this is the proof normalization does it.
    it('writes the fresh validation onto the book via normalization, with no manual update', async () => {
      // The eager fixture seeds `validation.valid: true`; the mutation below
      // resolves `valid: false`, so a stale read is visibly distinguishable
      // from a fresh one.
      const { client } = await openBookAnd([bookMock(), validateMutationMock()], /^validate$/i);

      await waitFor(() => {
        const cached = client.cache.readQuery({
          query: BookDetailDocument,
          variables: { libraryId: LIBRARY_ID, bookId: BOOK_ID },
        });
        const validation =
          cached?.node?.__typename === 'Library' ? cached.node.book?.validation : undefined;
        expect(validation?.valid).toBe(false);
      });
    });

    it('toasts a failure when the validate mutation throws', async () => {
      await openBookAnd(
        [
          bookMock(),
          {
            request: { query: BookValidateDocument, variables: { id: BOOK_ID } },
            error: new Error('Network error'),
          },
        ],
        /^validate$/i
      );

      expect(await screen.findByText('Validation failed')).toBeInTheDocument();
      expect(screen.queryByText(/no validation issues found/i)).not.toBeInTheDocument();
    });

    // Same never-resolving mock as the regen case, for the same reason.
    it('disables Validate while a validation is still in flight', async () => {
      await openBookAnd([bookMock(), { ...validateMutationMock(), delay: 100_000 }], /^validate$/i);

      const [trigger] = screen.getAllByRole('button', { name: 'More actions' });
      await userEvent.click(trigger);
      const item = await screen.findByRole('menuitem', { name: /^validate$/i });
      expect(item).toBeDisabled();
    });
  });
});
