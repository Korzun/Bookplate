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

// `useBookDetail`/`useBookValidation` both root through `useCurrentLibraryId`
// (an unconditional `ViewerBootstrap` query) — stubbed directly, the same
// convention `use-book-detail.test.tsx`/`page/series/index.test.tsx` use, to
// keep these tests focused on `BookDetailDocument`/`BookValidateDocument`.
// `useWithTargetUser` is ALSO stubbed here (not left to the real provider):
// `useDownloadBook` (unmigrated REST hook, still a page consumer) calls it.
vi.mock('~/provider/library-target', () => ({
  useCurrentLibraryId: () => ({ libraryId: LIBRARY_ID, loading: false }),
  useWithTargetUser: () =>
    Object.assign((url: string) => url, { ready: true, username: undefined }),
}));

import { makeFragmentData } from '~/gql';
import type { LineageEntryFragmentFragment } from '~/gql/graphql';
import { BookDetailDocument, BookValidateDocument, LineageEntryFragment } from '~/graphql/book';
import { apiFetch } from '~/lib/api-fetch';
import { ProgressProvider } from '~/provider/progress';
import { renderWithApollo } from '~/test-utils';

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
  URL.createObjectURL = vi.fn(() => 'blob:test-cover');
  URL.revokeObjectURL = vi.fn();
  // Differentiated by method, not a single blanket `mockResolvedValue`: the
  // "clear progress" regression test below needs a real `DELETE` → `204`
  // round trip (`useDeleteMyProgress` checks `response.status !== 204`
  // specifically), which a bare `{ ok: true }` doesn't satisfy. Every other
  // caller (the cover `blob()` fetch, `PUT` progress saves) only ever checks
  // `.ok`/`.blob()`, so folding them into one implementation is safe.
  mockApiFetch.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204 } as Response);
    }
    if (init?.method === 'PUT') {
      return Promise.resolve({ ok: true } as Response);
    }
    return Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' })),
    } as Response);
  });
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

const bookMock = (overrides: Record<string, unknown> = {}): MockedResponse => ({
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
          documentId: DOCUMENT_ID,
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
          validation: validationFixture,
          lineage: [],
          pendingFix: null,
          ...overrides,
        },
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
  // `ProgressProvider` is only mounted at the real app root (`App.tsx`), not
  // by `renderWithApollo`/`renderWithProviders` — every `SetProgressModal`
  // hook otherwise runs against `provider/progress/context.ts`'s DEFAULT
  // context value, whose setters are all no-ops. That silently defeated any
  // attempt to assert on a save-then-clear round trip (the "clear progress"
  // regression test below): the save's optimistic write never actually
  // landed anywhere for a later delete to find. Wrapping here matches how
  // this page is really composed in production.
  return renderWithApollo(
    <ProgressProvider>
      <BookPage />
    </ProgressProvider>,
    { ...options, mocks }
  );
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
      // list — this is a cache-hit read through `useBookValidation`, proved
      // below by there being no `BookValidationDocument` mock at all: an
      // empty `MockLink` throws on any unmatched operation, so reaching this
      // assertion IS the proof no round trip occurred.
      await waitFor(() => expect(screen.getByText(/3 warning/i)).toBeInTheDocument());
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
      await renderPage([
        bookMock({
          lineage: [
            makeFragmentData(
              rawLineageEntry({ oldId: 'doc-old-hash', newId: 'doc-current-hash' }),
              LineageEntryFragment
            ),
          ],
        }),
      ]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^book lineage$/i);

      // A real entry from `Book.lineage`, not the empty-list shim task 10 left.
      expect(await screen.findByText('doc-current-hash')).toBeInTheDocument();
      expect(screen.getByText('doc-old-hash')).toBeInTheDocument();
    });

    it("shows the book's RAW documentId as the current row when lineage is empty, never the GLOBAL id", async () => {
      await renderPage([bookMock({ lineage: [] })]);

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^book lineage$/i);

      // Proves the `bookId`/`documentId` prop split (2026-08-13 review): the
      // modal's display fallback is `book.documentId` (a raw content hash),
      // never `book.id` (the Relay global id `bookUnlinkDocument` needs).
      expect(await screen.findByText(DOCUMENT_ID)).toBeInTheDocument();
      expect(screen.queryByText(BOOK_ID)).not.toBeInTheDocument();
    });
  });

  // Task 12 (STEP-8 BRIDGE, see `SetProgressModal`'s `onSaved` doc comment):
  // `SetProgressModal` still writes progress through `ProgressProvider` over
  // REST (that migration is step 8); `book.progress` here comes off the
  // Apollo cache. These two tests need a real `username` — unlike every
  // other `renderPage` call above, which relies on `renderWithProviders`'
  // default anonymous user — because `useSetMyProgress` no-ops (never
  // resolves `saving`) when `username` is `undefined`.
  describe('set progress bridge', () => {
    const at = (percentage: number) =>
      bookMock({
        progress: {
          __typename: 'Progress' as const,
          id: 'UHJvZ3Jlc3M6MQ==',
          percentage,
          currentChapter: 3,
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

    it('refreshes the displayed progress after the set-progress modal saves', async () => {
      await renderPage([at(0.2), at(0.6)], { user: { username: 'le', isAdmin: false } });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');

      await selectMenuItem(/^set progress$/i);
      const modal = await getSetProgressDialog();
      await userEvent.click(modal.getByRole('button', { name: /save/i, hidden: true }));

      await waitFor(() =>
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')
      );
    });

    it('does not refetch when the modal is dismissed without saving', async () => {
      // Only ONE mock in the list. If `onSaved` fired on Cancel too (the bug
      // this guards against), the resulting refetch would be a SECOND
      // `BookDetail` operation with no matching mock left — `MockLink`
      // (`showWarnings` left on by `renderWithApollo`) logs "No more mocked
      // responses" and errors that operation's observable. That error
      // populates `useBookDetail`'s `error`, which flips this page from its
      // normal content to the "Failed to load book." branch — unmounting
      // `progressbar` entirely. So the `waitFor` below is the actual check:
      // not a literal DOM match on the warning text (this page never renders
      // `error.message`), but the progressbar surviving, unchanged, rather
      // than the whole page going to the error state.
      await renderPage([at(0.2)], { user: { username: 'le', isAdmin: false } });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });
      await selectMenuItem(/^set progress$/i);
      const modal = await getSetProgressDialog();
      await userEvent.click(modal.getByRole('button', { name: /cancel/i, hidden: true }));

      await waitFor(() =>
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
      );
      expect(screen.getByRole('heading', { name: 'A Wizard of Earthsea' })).toBeInTheDocument();
    });

    // C-1 (2026-08-13 final review): `SetProgressModal` used to be handed
    // `book.id` — the Relay GLOBAL id — for BOTH `useSetMyProgress` and
    // `useDeleteMyProgress`, which write/read the REST progress map keyed by
    // the RAW `documentId`. A save under the wrong key masks the bug (the
    // save and the later delete agree with EACH OTHER, just not with the
    // server's real key), so this drives a real save-then-clear round trip
    // and asserts on the literal URL `useDeleteMyProgress` asked `apiFetch`
    // for — the only way to actually catch "wrong KIND of id", not merely
    // "modal closed".
    it('issues the clear-progress DELETE against the raw documentId, never the global id', async () => {
      await renderPage([at(0.2), at(0.2)], { user: { username: 'le', isAdmin: false } });

      await screen.findByRole('heading', { name: 'A Wizard of Earthsea' });

      // Save once first — the only way this test populates `ProgressProvider`'s
      // REST-side map with a real entry to later clear (nothing else in this
      // render tree issues the REST `GET /api/my/progress` that map would
      // otherwise come from).
      await selectMenuItem(/^set progress$/i);
      let modal = await getSetProgressDialog();
      await userEvent.click(modal.getByRole('button', { name: /save/i, hidden: true }));
      await waitFor(() => expect(screen.queryByText('Set Progress')).not.toBeInTheDocument());
      // Waits out the `onSaved` refetch's own `loading` window (Apollo
      // re-flips `loading` briefly for a `refetch()`, unlike a cache-only
      // update) — `Page`'s loading branch drops `headerActions` (the "More
      // actions" trigger) entirely, so the next `selectMenuItem` needs the
      // refetched content back on screen first.
      await screen.findAllByRole('button', { name: 'More actions' });

      // Reopen and drag the slider to the leftmost position (chapter 0) to
      // surface "Clear Progress".
      await selectMenuItem(/^set progress$/i);
      modal = await getSetProgressDialog();
      const sliderRoot = await getSliderRoot();
      fireEvent.pointerDown(sliderRoot, { clientX: 0, pointerId: 1 });
      fireEvent.pointerUp(sliderRoot, { clientX: 0, pointerId: 1 });

      await userEvent.click(modal.getByRole('button', { name: /clear progress/i, hidden: true }));

      await waitFor(() =>
        expect(mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining(encodeURIComponent(DOCUMENT_ID)),
          expect.objectContaining({ method: 'DELETE' })
        )
      );
      expect(mockApiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(BOOK_ID)),
        expect.objectContaining({ method: 'DELETE' })
      );
      // The modal closes on a clean delete — proof the DELETE didn't just
      // fire, it SUCCEEDED against an id the server could resolve.
      await waitFor(() => expect(screen.queryByText('Set Progress')).not.toBeInTheDocument());
    });
  });
});
