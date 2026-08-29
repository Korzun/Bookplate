import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { Card, Page, ProgressIndicator, Tag, MetadataList, type Metadata } from '~/component';
import {
  BookLineageModal,
  ConfirmModal,
  SetProgressModal,
  UploadReplaceModal,
  ValidationDetailModal,
  type PageActionItem,
} from '~/control';
import { useFragment } from '~/gql';
import type {
  BookClearEditionsMutation,
  BookDeleteMutation,
  BookRegenChaptersMutation,
  BookValidateMutation,
  ValidationFragmentFragment,
} from '~/gql/graphql';
import {
  BookClearEditionsDocument,
  BookDeleteDocument,
  BookRegenChaptersDocument,
  BookValidateDocument,
  ValidationFragment,
} from '~/graphql/book';
import { AlertOctagonIcon, DeviceIcon } from '~/icon';
import type { Severity, ValidationMessage } from '~/lib/severity';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { useDownloadBook } from '~/lib/use-download-book';
import { usePrefetchOnIntent } from '~/lib/use-prefetch-on-intent';
import { unwrapResult } from '~/provider/apollo';
import { useIsAdmin } from '~/provider/auth';
import { useCurrentLibraryId } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
import { path } from '~/router';
import { formatSize, hashString } from '~/utils';

import { buildBookActions } from './actions';
import {
  BookChaptersDocument,
  BookDetailDocument,
  BookLineageDocument,
  BookValidationDocument,
} from './query';
import { useStyle } from './style';

/**
 * `counts` on `ValidationFragment` is a LIST (`{ severity count }[]`) — the
 * server shape, one entry per severity that actually occurred. The modal
 * (`ValidationDetailModal`, still shared with `page/upload` and the replace
 * flow, both on the REST-shaped record until a later step) takes
 * `Record<Severity, number>`. `SeverityCounts`' own `orderSeverityCounts`
 * reads `counts[severity] ?? 0`, so a partial record — every severity NOT in
 * the list is simply absent here — is safe to hand it; the cast matches the
 * same `Object.fromEntries(...) as Record<Severity, number>` idiom the
 * server's own `validation-store.ts` uses for the identical shape.
 */
// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so each is named explicitly here, extracted from the generated
// union rather than hand-duplicated — the same shape every inlined mutation
// in this project uses.
type BookRegenChaptersPayload = Extract<
  NonNullable<BookRegenChaptersMutation['bookRegenChapters']>,
  { __typename: 'BookRegenChaptersPayload' }
>;
type BookDeletePayload = Extract<
  NonNullable<BookDeleteMutation['bookDelete']>,
  { __typename: 'BookDeletePayload' }
>;
type BookClearEditionsPayload = Extract<
  NonNullable<BookClearEditionsMutation['bookClearEditions']>,
  { __typename: 'BookClearEditionsPayload' }
>;
type BookValidatePayload = Extract<
  NonNullable<BookValidateMutation['bookValidate']>,
  { __typename: 'BookValidatePayload' }
>;

function toValidationCounts(
  counts: ValidationFragmentFragment['counts']
): Record<Severity, number> {
  return Object.fromEntries(counts.map((c) => [c.severity, c.count])) as Record<Severity, number>;
}

/**
 * `ValidationMessage.id` is `node.code` (e.g. `"PKG-003"`), not `node.seq` —
 * matching REST's own `validation-store.ts` (`id: m.code`) byte-for-byte, so
 * a message keeps the same rendered id it always had. `location` collapses
 * the fragment's flat `path`/`line`/`column` into the modal's nested shape,
 * `undefined` when `path` is null (REST's own `m.path != null` check).
 *
 * `segments` (task 12b): the schema now exposes `ValidationMessage.segments`
 * (`message-segment/model.ts`), resolved server-side through the SAME
 * `splitSubjects` helper REST used, so this is a straight pass-through, not
 * a client-side reconstruction. This closes the narrowing the doc comment
 * here used to describe — quoted subjects render monospaced again, and the
 * modal's `m.segments ?? [{ text: m.message }]` fallback is no longer the
 * live path for THIS caller (`page/upload` and the replace flow still build
 * `ValidationMessage`s without `segments`, by design — see the modal's own
 * prop type; that fallback still matters for them).
 */
function toValidationMessages(
  edges: ValidationFragmentFragment['messages']['edges']
): ValidationMessage[] {
  return edges.map(({ node }) => ({
    id: node.code,
    severity: node.severity,
    message: node.message,
    segments: node.segments.map((s) => ({ text: s.text, subject: s.subject })),
    location:
      node.path != null
        ? { path: node.path, line: node.line ?? undefined, column: node.column ?? undefined }
        : undefined,
  }));
}

export const BookPage = () => {
  const styles = useStyle();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isAdmin] = useIsAdmin();

  /**
   * The route composes its own reads (`./query.ts`) rather than going
   * through a provider hook — `useBookDetail` had exactly one caller, this
   * file, and the indirection bought nothing but a second place to keep the
   * `book` shape in sync.
   *
   * `node(id: $libraryId)` is the only single root that serves both a
   * non-admin's own library and an admin's selected one, so the query is
   * skipped outright until `useCurrentLibraryId` resolves, and `loading`
   * folds that bootstrap round trip in — a skipped `useQuery` reports
   * `loading: false` on its own, which would flash a false "Book not found."
   * for the whole `ViewerBootstrap` window.
   *
   * **`$bookId` is the ROUTE PARAM**, deliberately, for all three documents
   * below. A book's global id rotates: `applyEpubChanges` (accept / replace
   * / undo) and `bookRegenChapters` re-import the file and mint a new one.
   * Every such path navigates to the new id (`onReplaced(newId)` below), so
   * keying on the param means the variables move WITH the book instead of
   * going stale — a lazy query left on a stale `bookId` would silently
   * fetch a different book's chapters, with no error to notice.
   */
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const variables = { libraryId: libraryId ?? '', bookId: id ?? '' };
  const {
    data,
    loading: bookLoading,
    error: bookError,
  } = useQuery(BookDetailDocument, { variables, skip: libraryId === undefined });
  const detailNode = data?.node;
  const book = detailNode?.__typename === 'Library' ? (detailNode.book ?? undefined) : undefined;
  const loading = bookLoading || libraryIdLoading;
  const error = bookError?.message;

  /**
   * The THIRD lazy read on this route, and the oldest: the validation modal's
   * payload (`threshold`, `validatedAt`, `counts`, `messages`) is expensive
   * enough that folding it into `BookDetail` pushed that document to 69% of
   * the breadth budget. `BookDetailDocument` keeps the cheap
   * `validation { id valid }` for `editingBlocked`; this fetches the rest,
   * and only when the modal is actually opened.
   *
   * `useLazyQuery`, not `useQuery`: this must issue NO operation on mount —
   * that is the whole point of the split, and what this route's "issues no
   * BookValidation operation until the modal is opened" test pins.
   *
   * `variables` — the SAME object the eager read uses, i.e. keyed on the
   * ROUTE PARAM, not on `book.id` from the settled query. That is what makes
   * this document root identically and merge onto the same `Book`/
   * `Validation` cache entities rather than competing with them, and it is
   * what keeps the read moving with the book across an id rotation.
   *
   * They ARE the same entity: `Validation.id` is byte-identical to the owning
   * Book's global id server-side (`graphql/book.ts`), so the eager
   * `{ id valid }` and this fuller payload land on one `Validation:<id>`
   * object — and so does `bookValidate`'s mutation response below.
   *
   * `execute` is passed its `variables` EXPLICITLY on every call: Apollo's
   * `useLazyQuery` execute function resets to EMPTY variables when called
   * with none ("If `variables` is not given, reset back to empty
   * variables"), so the hook-level default is not enough.
   */
  // Only `data` is read. The hook this replaces also exposed `loading` and
  // `error`; `page/book` destructured neither, and there is nowhere sensible
  // to show them — `loadValidation()` is a CACHE HIT off the mutation that
  // just wrote the payload, so it has no transport of its own to fail.
  const [executeValidationRead, { data: validationData }] = useLazyQuery(BookValidationDocument);
  const validationNode = validationData?.node;
  const lazyValidation =
    validationNode?.__typename === 'Library'
      ? (validationNode.book?.validation ?? undefined)
      : undefined;
  // `useFragment` is an identity cast (Global Constraints — masking is
  // compile-time only here), but called unconditionally before either early
  // return below anyway, the same discipline `page/series` follows for its
  // own `useFragment` call.
  const unmaskedValidation = useFragment(ValidationFragment, lazyValidation);

  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [lineageModalOpen, setLineageModalOpen] = useState(false);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [validationModalOpen, setValidationModalOpen] = useState(false);

  /**
   * The two LAZY splits. Each is gated on the SAME boolean that mounts its
   * modal below, so nothing is fetched for a modal a visitor never opens —
   * which is the entire point of the split (`./query.ts` for the per-field
   * disposition and the cache-identity contract).
   *
   * Composed HERE rather than inside the modals themselves: those are
   * `~/control` components, the shared layer, and a book-scoped query in
   * there would both invert the dependency direction and hand two
   * presentational modals a `useCurrentLibraryId` dependency. The route
   * already owns when they mount, so it can own the gate too — spec 3.1's
   * normal "the route composes the query" rule. (`MyProgressContent` is the
   * documented exception, and only because `Card` mounts it outside its
   * route's control.)
   *
   * `skip` is belt-and-braces with the `{open && …}` render gates: a
   * skipped hook cannot fetch even if a later refactor stops unmounting the
   * modal, and it is what the "does not fetch until the modal opens" tests
   * pin.
   *
   * **Both `error`s are forwarded, not discarded.** Before the split, a
   * failure to read `lineage` was a failed PAGE load ("Failed to load
   * book."). Split out and defaulted (`?? []`), the same failure would
   * instead render `BookLineageModal`'s EMPTY-lineage presentation — the
   * page asserting "this book has no edit history" when the truth is "we
   * could not find out". Empty is a meaningful answer there, so the two
   * must look different; each modal owns that distinction through its own
   * `error`/`chaptersError` prop.
   */
  const { data: chaptersData, error: chaptersError } = useQuery(BookChaptersDocument, {
    variables,
    skip: !progressModalOpen || libraryId === undefined,
  });
  const chaptersNode = chaptersData?.node;
  const chapters = chaptersNode?.__typename === 'Library' ? chaptersNode.book : null;

  const { data: lineageData, error: lineageError } = useQuery(BookLineageDocument, {
    variables,
    skip: !lineageModalOpen || libraryId === undefined,
  });
  const lineageNode = lineageData?.node;
  const lineageBook = lineageNode?.__typename === 'Library' ? lineageNode.book : null;

  /**
   * The other half of the split: fire each lazy query on hover/focus/touch
   * of its own action, ahead of the click that opens the modal. Apollo
   * dedupes the identical in-flight query, so the `useQuery` above usually
   * finds the data already arriving or cached by the time it mounts.
   *
   * `variables` is a fresh object literal per render, so `intentProps`'
   * identity churns every render — correctness is unaffected (the
   * freshness guard lives in a ref, keyed on the variables' VALUE), but do
   * not hang a `React.memo` off its identity.
   */
  const chaptersIntent = usePrefetchOnIntent(BookChaptersDocument, variables, {
    skip: libraryId === undefined,
  });
  const lineageIntent = usePrefetchOnIntent(BookLineageDocument, variables, {
    skip: libraryId === undefined,
  });

  /**
   * The four book mutations this page triggers, inlined at their call site
   * now that `provider/book` is gone (spec §3.2). Each keeps its own
   * in-flight flag: the flag drives a modal's or an action's `loading` state
   * AND guards re-entrancy, exactly as the tuple-shaped hooks did.
   *
   * **Failures are TOASTED, not swallowed.** The deleted hooks each carried
   * an `error`/`errorMessage` pair that `page/book` destructured away — so a
   * failed regen or delete was silently invisible, while its two siblings
   * (clear-editions, download) already toasted. Rather than inline dead
   * state, every failure now surfaces through the toast this page already
   * uses. That is a deliberate, small addition; the alternative was to drop
   * the error mapping the hook tests pinned.
   */
  const [runRegen] = useMutation(BookRegenChaptersDocument);
  const [runDelete] = useMutation(BookDeleteDocument);
  const [runClearEditions] = useMutation(BookClearEditionsDocument);
  const [runValidate] = useMutation(BookValidateDocument);
  const [regenLoading, setRegenLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearingEditions, setClearingEditions] = useState(false);
  const [validating, setValidating] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clearEditionsModalOpen, setClearEditionsModalOpen] = useState(false);
  const [downloadBook] = useDownloadBook();
  const showToast = useToast();

  /**
   * A regen is an `applyEpubChanges`-shaped write, and its `update` treats it
   * as one. `reimportBook` (`app/server/services/book-lifecycle.ts`) RE-PARSES the
   * EPUB and writes back `title`, `titleSort`, `author`, `authorSort`,
   * `publisher`, `publishDate`, `description`, `series`, `seriesIndex`,
   * `identifiers`, `subjects`, `coverData`, `coverMime` and `seriesId` — in
   * BOTH the rotating and the non-rotating branch — and it also mutates
   * series topology (deleting an emptied `Series` row, otherwise recomputing
   * its meta). A "regen only touches chapters" reading of this mutation is
   * wrong, and the three gaps below all followed from it. All three are now
   * closed; the reasoning is kept because it is what makes the code look
   * over-broad when it is not.
   *
   * `BookRegenChaptersDocument` selects only `book { id chapterCount
   * chapterNames chapterSpineMap }`, so the payload carries NONE of those
   * rewritten fields. Hence two evictions, both UNCONDITIONAL on success:
   *
   *   1. **`Library.entries`** (every filter variant, no `args`), because
   *      the new position in a sorted, filtered, paginated connection is the
   *      server's to decide, and a SERIES-typed edge's `bookCount` can be
   *      wrong if the book left its series. This matches the three sibling
   *      id-rotating paths exactly — `component/book-edit-form`'s save,
   *      `control/upload-replace-modal`'s replace, and the upload queue's
   *      ACCEPT/UNDO (`provider/upload/hook/use-upload-queue.ts`). Regen was
   *      the only one that did not. **Not free**: `entries` is
   *      `relayStylePagination(['filter'])`, so this discards every page
   *      `fetchMore` accumulated — the same cost the DELETE handler's comment
   *      below records, accepted for the same reason.
   *
   *   2. **The `Book:<targetId>` entity itself**, which covers both branches
   *      with one statement. When the id ROTATES, `targetId` names the
   *      superseded entity — normalization has already written a brand-new
   *      `Book:<newId>` from the payload and cannot know the old one
   *      described the same book, so the stale entity has to go by name
   *      (`cache.gc()` will not take it: a `Library.book(id: oldGid)` field
   *      from any prior visit still REFERENCES it). When the id does NOT
   *      rotate — the COMMON case, since a regen usually re-parses a file
   *      whose hash is unchanged — `targetId` names the entity the server
   *      has just rewritten every grid-visible field of, and normalization
   *      refreshed only the three chapter fields on it. Nothing dangles
   *      there, so no incomplete-diff refetch rescues it and the stale
   *      title/author/cover would live in the cache indefinitely.
   *
   * Evicting on the non-rotating branch rather than WIDENING the payload to
   * carry the rewritten fields is a deliberate trade. Widening costs breadth
   * on every regen; evicting costs one refetch of a book the user is looking
   * at right now, which is immediate, complete, and keeps the mutation
   * narrow. The open page's own `BookDetail` read is what repairs it — the
   * `Library.book` reference goes dangling, the diff comes back incomplete,
   * and Apollo refetches.
   *
   * **The navigate is not an alternative to the server fix, and neither is
   * redundant.** On a rotation the route param still holds the OLD id; left
   * alone the page falls through to "Book not found." and a RELOAD does not
   * help, because the same URL hits the same dead id. This mirrors the
   * `onReplaced(newId)` precedent already in this file. The deeper half is
   * server-side: `Library.book(id:)` now resolves a superseded id through
   * `bookStore.resolveBookId` (`app/server/graphql/schema/library/model.ts`),
   * which makes EVERY stale book id recoverable — bookmarks, the back
   * button, a shared link, a second tab — not just this handler's path. This
   * navigate still earns its place: it keeps the URL from silently lying
   * about which id the user is on.
   *
   * `BookRegenChaptersResult` has two error members (`BookHashCollisionError`,
   * `BookNotValidatedError`); both expose only `message`, so `unwrapResult`
   * maps them uniformly with no per-typename branching.
   */
  const handleRegenChapters = useCallback(
    async (targetId: string) => {
      if (regenLoading) return;
      setRegenLoading(true);
      try {
        const { data: regenData } = await runRegen({
          variables: { id: targetId },
          update: (cache, { data: mutationData }) => {
            const outcome = unwrapResult<BookRegenChaptersPayload>(
              mutationData?.bookRegenChapters,
              'BookRegenChaptersPayload'
            );
            if (outcome.status !== 'ok') return;

            if (libraryId !== undefined) {
              cache.evict({
                id: cache.identify({ __typename: 'Library', id: libraryId }),
                fieldName: 'entries',
              });
            }
            cache.evict({ id: cache.identify({ __typename: 'Book', id: targetId }) });
            cache.gc();
          },
        });
        const result = unwrapResult<BookRegenChaptersPayload>(
          regenData?.bookRegenChapters,
          'BookRegenChaptersPayload'
        );
        if (result.status === 'missing') {
          showToast('Failed to regenerate chapters', 'error');
          return;
        }
        if (result.status === 'error') {
          showToast(result.message, 'error');
          return;
        }
        if (result.payload.book.id !== targetId) {
          navigate(path.book(result.payload.book.id));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to regenerate chapters', 'error');
      } finally {
        setRegenLoading(false);
      }
    },
    [runRegen, regenLoading, showToast, libraryId, navigate]
  );

  /**
   * `update` does TWO things, not one:
   *
   *   1. Evicts the deleted `Book` entity (+ `cache.gc()`). That alone
   *      handles a STANDALONE book's row, though NOT by the mechanism an
   *      earlier version of this comment claimed. `InMemoryCache` does not
   *      "silently drop" an edge whose `node` reference has been evicted: the
   *      read reports `missing: "Dangling reference to missing … object"`
   *      (`@apollo/client`'s `readFromStore`), and the `canRead` filter that
   *      prunes dangling refs from a LIST cannot save this one, because
   *      `LibraryEntriesConnectionEdge` has no `id` and so is stored inline —
   *      the dangling reference sits one level deeper, at `edge.node`. The
   *      diff therefore comes back INCOMPLETE, which is a cache miss and
   *      sends the next `LibraryEntries` read to the network. Right outcome,
   *      different mechanism — and it is why step 2 below is load-bearing
   *      rather than belt-and-braces.
   *
   *   2. Evicts the OWNING `Library`'s ENTIRE `entries` field (every filter
   *      variant, no `args`). Required because deleting the LAST book in a
   *      series makes the SERVER also delete the `Series` row, while
   *      `BookDeletePayload` carries no `deletedSeriesId` — the client has no
   *      id to evict a `Series` entity with, and the SERIES-typed edge that
   *      references the deleted book still lingers with a now-wrong
   *      `bookCount`. Evicting the field makes the next `LibraryEntries` read
   *      a genuine cache miss. `cache.identify` needs the Library's own
   *      global id, which is why the document selects `library { id }`
   *      alongside `deletedId`.
   *
   *      **Not free**: `entries` is `relayStylePagination(['filter'])`, so
   *      this discards every page `fetchMore` had accumulated — a user deep
   *      in the grid restarts at page 1 on the next read.
   */
  const handleDeleteConfirm = useCallback(async () => {
    setDeleteModalOpen(false);
    const targetId = book?.id ?? '';
    if (deleting) return;
    setDeleting(true);
    try {
      const { data: deleteData } = await runDelete({
        variables: { id: targetId },
        update: (cache, { data: mutationData }) => {
          const outcome = unwrapResult<BookDeletePayload>(
            mutationData?.bookDelete,
            'BookDeletePayload'
          );
          if (outcome.status !== 'ok') return;

          cache.evict({
            id: cache.identify({ __typename: 'Book', id: outcome.payload.deletedId }),
          });
          cache.evict({
            id: cache.identify({ __typename: 'Library', id: outcome.payload.library.id }),
            fieldName: 'entries',
          });
          cache.gc();
        },
      });
      const result = unwrapResult<BookDeletePayload>(deleteData?.bookDelete, 'BookDeletePayload');
      if (result.status === 'missing') showToast('Failed to delete book', 'error');
      else if (result.status === 'error') showToast(result.message, 'error');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete book', 'error');
    } finally {
      setDeleting(false);
    }
    // Navigation is unconditional, exactly as before this task: the book is
    // gone from this page's point of view either way, and a failed delete now
    // says so through the toast above rather than silently.
    navigate(path.home());
  }, [runDelete, deleting, book, navigate, showToast]);

  /**
   * No hand-written `update`: `BookClearEditionsPayload` re-selects
   * `book { id deviceEditionCount }`, and Apollo's normalization writes the
   * new count onto the existing `Book` entity. `BookClearEditionsResult` is a
   * single-member union today — no error branch — but `unwrapResult` still
   * distinguishes `missing` (the field resolved null) from a typed error, and
   * both are toasted.
   */
  const handleClearEditionsConfirm = useCallback(async () => {
    setClearEditionsModalOpen(false);
    const targetId = book?.id ?? '';
    if (clearingEditions) return;
    setClearingEditions(true);
    try {
      const { data: clearData } = await runClearEditions({ variables: { id: targetId } });
      const result = unwrapResult<BookClearEditionsPayload>(
        clearData?.bookClearEditions,
        'BookClearEditionsPayload'
      );
      if (result.status === 'missing') {
        showToast('Failed to clear device editions', 'error');
        return;
      }
      if (result.status === 'error') {
        showToast(result.message, 'error');
        return;
      }
      const cleared = result.payload.clearedCount;
      showToast(`Cleared ${cleared} device edition${cleared === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to clear device editions', 'error');
    } finally {
      setClearingEditions(false);
    }
  }, [runClearEditions, clearingEditions, book, showToast]);

  const handleDownload = useCallback(async () => {
    const ok = await downloadBook(book?.id ?? '');
    if (!ok) showToast('Download failed', 'error');
  }, [downloadBook, book, showToast]);

  /**
   * Closes the debt Task 9 left open: `validateBook`'s resolved (masked)
   * `ValidationFragment` ref is no longer just toasted as a blanket
   * "Validation complete" regardless of outcome — a book that FAILS
   * validation now looks nothing like one that passes, because this opens
   * `ValidationDetailModal` for BOTH, and the modal itself renders the real
   * pass/fail difference (an empty "No validation issues found" state vs a
   * real message list).
   *
   * `executeValidationRead()` — NOT reading the mutation payload directly —
   * is the single path that populates `ValidationDetailModal`'s data, the
   * same lazy read a future "open validation report" entry point (not wired
   * yet — there is only this one trigger today) would also use.
   * `Validation.id` is byte-identical to the owning Book's global id
   * (`graphql/book.ts`), so `bookValidate`'s payload has already normalized
   * onto the exact `Validation` entity `BookValidationDocument` reads —
   * this is a CACHE HIT with no network round trip, only a fresh reactive
   * read of what the mutation just wrote. Asserted directly in this file's
   * test ("opens the validation modal ... with no BookValidationDocument
   * mock in the list").
   *
   * `bookValidate` needs no hand-written `update` for the same reason: its
   * payload carries `validation` as a TOP-LEVEL field, keyed by an id that
   * IS the Book's, so every reader of `Book.validation` sees it immediately.
   */
  const handleValidate = useCallback(async () => {
    const targetId = book?.id ?? '';
    if (validating) return;
    setValidating(true);
    try {
      const { data: validateData } = await runValidate({ variables: { id: targetId } });
      const result = unwrapResult<BookValidatePayload>(
        validateData?.bookValidate,
        'BookValidatePayload'
      );
      if (result.status !== 'ok') {
        showToast('Validation failed', 'error');
        return;
      }
      // Rebuilt here rather than closing over the render-scoped `variables`
      // literal, which is a fresh object every render: same VALUES, stable
      // dependencies.
      void executeValidationRead({
        variables: { libraryId: libraryId ?? '', bookId: id ?? '' },
      });
      setValidationModalOpen(true);
    } catch {
      showToast('Validation failed', 'error');
    } finally {
      setValidating(false);
    }
  }, [runValidate, validating, book, showToast, executeValidationRead, libraryId, id]);

  const handleEditMetadata = useCallback(
    () => navigate(path.bookEdit(book?.id ?? '')),
    [book, navigate]
  );

  const handleSeriesNavigate = useCallback(() => {
    if (book?.series) {
      navigate(path.series(book.series.name));
    }
  }, [book, navigate]);

  const handleSubjectNavigate = useCallback(
    (subject: string) => navigate(path.library({ subject })),
    [navigate]
  );

  const handleAuthorNavigate = useCallback(
    () => navigate(path.library({ author: book?.author ?? '' })),
    [book, navigate]
  );

  // Metadata
  const metadata: Metadata[] = [];
  if (!isAdmin) {
    metadata.push({
      title: 'progress',
      value: (
        <ProgressIndicator
          value={book?.progress ? book.progress.percentage : 0}
          ariaLabel={book ? `Reading progress for ${book.title}` : 'Reading progress'}
          size={12}
        />
      ),
    });
  }
  if (book !== undefined && book.chapterCount > 0) {
    metadata.push({ title: 'chapters', value: book.chapterCount.toString() });
  }
  if (book !== undefined && book.pageCount > 0) {
    metadata.push({ title: 'pages', value: book.pageCount.toString() });
  }
  if (book !== undefined && book.publisher) {
    metadata.push({ title: 'publisher', value: book.publisher });
  }
  if (book !== undefined && book.publishDate) {
    const formatted = new Date(book.publishDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    metadata.push({ title: 'published', value: formatted });
  }
  if (book !== undefined) {
    metadata.push({ title: 'size', value: formatSize(book.size) });
  }

  // Description
  const description = useMemo(() => {
    if (book?.description === undefined) {
      return [];
    }
    return book.description
      .replace(/<\/?[^>]+(>|$)/g, '')
      .split(/\r?\n/)
      .filter((paragraph) => paragraph.trim())
      .map((paragraph) => <p key={hashString(paragraph.trim())}>{paragraph.trim()}</p>);
  }, [book]);

  const coverSrc = useAuthorizedSrc(book?.hasCover ? book.coverUrl : null);

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={styles.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  // Checked BEFORE the not-found branch below — see `page/series`' own doc
  // comment on the same ordering: a transport failure also leaves `book`
  // `undefined`, and OR-ing it into "Book not found." would misreport a
  // network failure as the book genuinely not existing.
  if (error !== undefined) {
    return (
      <Page>
        <Card>
          <p className={styles.notFound}>Failed to load book.</p>
        </Card>
      </Page>
    );
  }

  if (book === undefined) {
    return (
      <Page>
        <Card>
          <p className={styles.notFound}>Book not found.</p>
        </Card>
      </Page>
    );
  }

  const actions: PageActionItem[] = buildBookActions(
    {
      chapterCount: book.chapterCount,
      deviceEditionCount: book.deviceEditionCount,
      regenLoading,
      validating,
      editingBlocked: book.validation?.valid !== true,
    },
    {
      onSetProgress: () => setProgressModalOpen(true),
      onSetProgressIntent: chaptersIntent.intentProps,
      onEditMetadata: handleEditMetadata,
      onShowLineage: () => setLineageModalOpen(true),
      onShowLineageIntent: lineageIntent.intentProps,
      onRegenChapters: () => void handleRegenChapters(book.id),
      onClearEditions: () => setClearEditionsModalOpen(true),
      onValidate: () => void handleValidate(),
      onUploadReplace: () => setReplaceModalOpen(true),
      onDownloadBook: () => void handleDownload(),
      onDeleteBook: () => setDeleteModalOpen(true),
    }
  );

  return (
    <Page
      back={book.series !== null ? path.series(book.series.name) : path.library()}
      headerActions={actions}
    >
      <Card>
        <div className={styles.cardContainer}>
          <div className={styles.detail}>
            {book.hasCover ? (
              <img
                className={styles.coverImg}
                src={coverSrc}
                alt={book.title}
                width={160}
                height={240}
              />
            ) : (
              <div className={styles.coverPlaceholder} />
            )}
            <div className={styles.info}>
              <div className={styles.titleContainer}>
                <h1 className={styles.title}>{book.title}</h1>
                {book.series !== null && (
                  <span className={styles.series} onClick={handleSeriesNavigate}>
                    ({book.series.name}
                    {book.seriesIndex > 0 ? ` #${book.seriesIndex}` : ''})
                  </span>
                )}
              </div>
              {book.author.length > 0 && (
                <div
                  className={styles.author}
                  onClick={handleAuthorNavigate}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleAuthorNavigate();
                    }
                  }}
                >
                  {book.author}
                </div>
              )}
            </div>
          </div>
          <div className={styles.metadata}>
            <MetadataList metadata={metadata} />
          </div>
        </div>
      </Card>
      <Card title="Description">
        <div className={styles.description}>{description}</div>
      </Card>
      <Card title="Subjects">
        {book.subjects.length > 0 && (
          <div className={styles.subjects}>
            {book.subjects.map((subject, index) => (
              <Tag key={subject + index} onClick={() => handleSubjectNavigate(subject)}>
                {subject}
              </Tag>
            ))}
          </div>
        )}
      </Card>
      {progressModalOpen && (
        <SetProgressModal
          isOpen
          documentId={book.documentId}
          progressId={book.progress?.id}
          chapterCount={book.chapterCount}
          initialChapter={book.progress?.currentChapter ?? 0}
          // From `BookChaptersDocument`, not the eager read — both default
          // harmlessly (`[]`) for the beat before the lazy query lands,
          // which the hover prefetch usually removes entirely.
          chapterSpineMap={chapters?.chapterSpineMap}
          chapterNames={chapters?.chapterNames ?? []}
          chaptersError={chaptersError?.message}
          onClose={() => setProgressModalOpen(false)}
        />
      )}
      {lineageModalOpen && (
        <BookLineageModal
          isOpen
          bookId={book.id}
          documentId={book.documentId}
          bookTitle={book.title}
          // Both from `BookLineageDocument` — `addedAt` travels with
          // `lineage` because it is only ever read as that list's
          // oldest-row fallback timestamp.
          lineage={lineageBook?.lineage ?? []}
          addedAt={lineageBook?.addedAt ? new Date(lineageBook.addedAt).getTime() : undefined}
          error={lineageError?.message}
          onClose={() => setLineageModalOpen(false)}
        />
      )}
      <ConfirmModal
        icon={AlertOctagonIcon}
        isOpen={deleteModalOpen}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        danger
        title="Delete book permanently?"
        confirmText="Delete"
        loading={deleting}
      >
        This action will delete <span className={styles.deleteBook}>{book.title}</span> and its file
        from this library, along with any synced progress, and{' '}
        <span className={styles.deleteUndone}>can not be undone</span>.
      </ConfirmModal>
      <ConfirmModal
        icon={DeviceIcon}
        isOpen={clearEditionsModalOpen}
        onCancel={() => setClearEditionsModalOpen(false)}
        onConfirm={handleClearEditionsConfirm}
        title="Clear device editions?"
        confirmText="Clear editions"
        loading={clearingEditions}
      >
        All cached device editions for this book will be removed. They&apos;ll be regenerated the
        next time each device downloads it.
      </ConfirmModal>
      {replaceModalOpen && (
        <UploadReplaceModal
          isOpen
          bookId={book.id}
          bookTitle={book.title}
          onClose={() => setReplaceModalOpen(false)}
          onReplaced={(newId) => {
            setReplaceModalOpen(false);
            // `newId` is `UploadReplaceModal`'s `onReplaced` — the Relay
            // GLOBAL id for the post-replace book (2026-08-13 final review,
            // C-2 — human ruling, Option 1, fixed). `commitReplacement`'s
            // response is `ReplacedBook = { id: string }`; the raw content
            // hash it used to also carry was dropped in Task 10. This page's
            // own `Library.book` read requires a global id, and now gets one.
            navigate(path.book(newId));
          }}
        />
      )}
      {validationModalOpen && unmaskedValidation && (
        <ValidationDetailModal
          isOpen
          filename={book.title}
          counts={toValidationCounts(unmaskedValidation.counts)}
          messages={toValidationMessages(unmaskedValidation.messages.edges)}
          threshold={unmaskedValidation.threshold}
          // I-2 (2026-08-13 final review): the modal's DEFAULT `intro` is
          // upload-flow copy ("...must be fixed before this EPUB can be
          // uploaded") — wrong for a book already in the library. This is
          // the same book-specific copy the pre-GraphQL REST page passed,
          // dropped as collateral during the rewrite to GraphQL.
          intro="EPUBCheck results for this book. Issues below the rejection threshold don't block anything, but you may want to fix them."
          onClose={() => setValidationModalOpen(false)}
        />
      )}
    </Page>
  );
};
