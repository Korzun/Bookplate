import { useMutation, useQuery } from '@apollo/client/react';
import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { graphql } from '~/gql';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import { useCurrentLibraryId } from '~/provider/library-target';
import { path } from '~/router';

import { useStyle } from './style';

/**
 * The edit form's read, composed HERE — this route is its only consumer.
 * (`control/upload-replace-modal/use-replace-book.test.tsx` also imports it,
 * as a cache fixture, exactly as it imports `LibraryEntriesDocument` from
 * `~/page/library`.)
 *
 * Deliberately SEPARATE from `BookDetailDocument` (`page/book/query.ts`)
 * rather than an extension of it: the form needs `titleSort`, `authorSort`
 * and `identifiers`, which the detail page never renders, and both documents
 * are measured against the same 70% breadth gate. Two documents keep each
 * screen's selection honest.
 *
 * **`$bookId` is the ROUTE PARAM**, deliberately — the same discipline
 * `page/book` records. A book's global id ROTATES: a metadata save here
 * rewrites the EPUB, changing its content hash and therefore the id, and so
 * do replace / accept / undo elsewhere. Keying on the param means the
 * variables move with the book (`BookEditForm` navigates to
 * `path.book(patched.id)` on save, so this route unmounts rather than
 * re-reading a superseded id) instead of silently addressing a book that no
 * longer exists.
 *
 * **The body is one fragment spread, not an inline selection.**
 * `...BookEditFormFragment` (`component/book-edit-form`) is the form's own
 * declaration of what it renders. The three fields selected here as siblings
 * are the ones the ROUTE reads and the form never sees: `id` (the guard's
 * dismiss target), `validation` (the edit gate) and `pendingFix` (the guard).
 *
 * **Cost (`npm run test:cost -w app/server`): breadth 40 → 33 (33.0%),
 * complexity 40 → 33.** MEASURED, not estimated. The history is worth
 * keeping because it is the same document being narrowed twice for two
 * different reasons: Task 8 took it 46 → 40 by dropping an unrendered
 * `documentId` (−1) and trimming `pendingFix.state.proposals` from the full
 * 8-field `MetadataFix` shape to `{ to }` (−7), against a
 * `...BookEditFormFragment` that cost **+2**, not the +1 spec §4.0 predicts
 * — codegen injects `__typename` both into the spread and into the wrapping
 * selection set and the cost walker counts both. Replacing `pendingFix { id
 * state { proposals { to } } }` with `hasActionablePendingFix` then took it
 * 40 → 33: eight counted nodes out (four fields plus the `__typename`
 * codegen injects into each of the three selection sets), one in. If you
 * change this document, re-measure rather than deriving from §4.0's figure.
 *
 * **Why the guard reads a server BOOLEAN and not the proposals.**
 * `PendingFixState` declares four fields (`appliedFixes`, `autoFixes`,
 * `proposals`, `undo` — `schema.generated.graphql`), has NO `id`, and has no
 * `keyFields` entry in `provider/apollo/cache.ts`. It is therefore NOT a
 * normalized entity: it is an inline object the cache replaces WHOLESALE.
 * Any `state` selection made from HERE lands in the SHARED `PendingFix:<id>`
 * cache entity and destroys whatever fuller `state` was already there.
 *
 * That was a real, measured cost, not a theoretical one.
 * `LibraryPendingFixesDocument` (`~/graphql/upload`) is watched APP-WIDE —
 * `component/nav/index.tsx` (the badge) and
 * `provider/upload/hook/use-upload-queue.ts` each hold a live `useQuery` on
 * it — so its watcher is active for the whole time `/book-edit` is open, not
 * dormant. Measured directly against `InMemoryCache(cacheConfig)`: seed
 * `LibraryPendingFixes` for a library with one `PendingFix`, and
 * `cache.diff()` reported `complete: true`; write the OLD version of this
 * document over it and the same diff reported `complete: false`, missing
 * `state.autoFixes`, `state.appliedFixes` and every `proposals` field except
 * `to`. An incomplete diff on a watched query is a refetch — of a breadth-55
 * (55.0%) / complexity-4807 (14.6%) operation, the client's second most
 * expensive — once per book-edit visit to a book that has a pending fix. No
 * user-visible corruption, one spurious round trip.
 *
 * It did NOT originate with Task 8's `proposals` trim. Verified against
 * `183dfb36`, where this document still selected the full 8-field
 * `MetadataFix` shape: `state` was ALREADY missing
 * `appliedFixes`/`autoFixes`/`undo` there. The trim narrowed an
 * already-partial write; it did not create one.
 *
 * `Book.hasActionablePendingFix` (`app/server/graphql/schema/book/model.ts`)
 * removes the write entirely rather than completing it. A boolean touches no
 * shared entity, so no future narrowing of this document can reopen the
 * defect — which widening the selection back to the full `state` would not
 * have guaranteed, and which a `PendingFixState: { merge: true }` policy
 * would only have half-delivered: shallow-merging preserves the SIBLING
 * fields, but `proposals` is still replaced by an array of objects carrying
 * only `to`, and merging arrays positionally is its own hazard. It is a
 * schema addition and so a deliberate API decision, taken because the guard
 * question — "is there a live fix with an actionable proposal?" — is the
 * server's rule to answer anyway (advisory `to: null` proposals do not
 * count; see that field's own comment), and because it costs 1 breadth here
 * while removing 8 — net −7 on this document, against +1 on
 * `BookResolvePendingFix` (67 → 68), which is the closest operation in the
 * client to the 70% gate and is called out in its own comment.
 *
 * The one place that had to follow: `BookResolvePendingFixDocument` now
 * selects `hasActionablePendingFix` on its payload `book`, so a DISMISS from
 * this page still clears the guard through ordinary normalization. Without
 * it the flag would stay `true` on the cached `Book` and the modal would
 * never come down.
 */
export const BookEditDocument = graphql(`
  query BookEdit($libraryId: ID!, $bookId: ID!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        book(id: $bookId) {
          id
          ...BookEditFormFragment
          validation {
            id
            valid
          }
          hasActionablePendingFix
        }
      }
    }
  }
`);

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const navigate = useNavigate();

  /**
   * `node(id: $libraryId)` is the only single root that serves both a
   * non-admin's own library and an admin's selected one, so the query is
   * SKIPPED outright until `useCurrentLibraryId` resolves, and `loading`
   * folds that bootstrap round trip in — a skipped `useQuery` reports
   * `loading: false` on its own, which would flash a false "Book not found."
   * for the whole `ViewerBootstrap` window.
   *
   * **A book id the library does not have** resolves `book` to `null` — the
   * server's own "not found" answer, not a failure. It arrives here as
   * `book === undefined` with no error, told apart from "not loaded yet" by
   * `loading`, exactly as `page/book` and `page/series` do it.
   */
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const {
    data,
    loading: bookLoading,
    error: bookError,
  } = useQuery(BookEditDocument, {
    variables: { libraryId: libraryId ?? '', bookId: id ?? '' },
    skip: libraryId === undefined,
  });

  const node = data?.node;
  const book = node?.__typename === 'Library' ? (node.book ?? undefined) : undefined;
  const loading = bookLoading || libraryIdLoading;
  const error = bookError?.message;

  // The book-edit page's own pending-fix conflict, read straight off this
  // page's own query (`BookEditDocument`'s `book.hasActionablePendingFix`)
  // instead of a separate queue-keyed lookup.
  // The RULE this flag encodes is unchanged, it just moved to the server
  // (`Book.hasActionablePendingFix`, and the tests in
  // `graphql/schema/pending-fix/model.test.ts` that pin it under opposite
  // mutations). A live row with no proposals left (fully resolved, undo still
  // armed within the TTL) is not a conflict. Neither is one whose every
  // remaining proposal is ADVISORY (`to === null`, "needs review"): the guard
  // exists because editing could overwrite a concrete pending suggestion, and
  // an advisory fix has no suggested value to overwrite. It is also the only
  // kind `FixReview` resolves by linking HERE — `bookResolvePendingFix`'s
  // ACCEPT filters to `to !== null` and leaves advisory proposals behind, so
  // they can never be cleared by accepting. Guarding on them bounced the user
  // straight back to the screen whose Edit link sent them, with no way out.
  // Same rule `control/upload-replace-modal` already applies to gate Replace.
  //
  // `?? false` covers only the not-yet-loaded / not-found `book`, which the
  // branches below own outright — this value is never read before them.
  const hasPendingConflict = book?.hasActionablePendingFix ?? false;
  // The mutation is called DIRECTLY here, not through `useUploadQueue()`:
  // the dismiss action only ever needs this book's own GLOBAL id (`book.id`,
  // always in hand here), never the queue's per-render item id — which for a
  // book whose upload is still a live transport item in this tab would be a
  // different string entirely. That is what keeps this page independent of
  // `UploadProvider` altogether, not merely for conflict detection.
  //
  // NO `update` function, deliberately: a bulk DISMISS touches only the
  // pending-fix row, and the payload's own `library { pendingFixes }`
  // selection reconciles it through ordinary normalization — the guard modal
  // above and the row list share one `PendingFix:<id>` entity. Only ACCEPT
  // and UNDO rewrite the EPUB and so need `Library.entries` evicted; the
  // upload queue's engine owns that branch, and this page can never reach it.
  //
  // `BookResolvePendingFixDocument` lives in `~/graphql/upload.ts`, a leaf
  // module rather than this route file, because the kept `UploadProvider`
  // reads it too.
  const [resolvePendingFix] = useMutation(BookResolvePendingFixDocument);
  // Errors are swallowed on purpose, and the catch is what does it: the
  // caller below is a fire-and-forget click handler with nowhere to render a
  // message, and an uncaught rejection out of `void` would surface as an
  // unhandled promise rejection instead. The guard modal simply stays up if
  // the dismiss fails, which is the safe outcome.
  const dismissPendingFixes = (bookGlobalId: string) =>
    resolvePendingFix({ variables: { id: bookGlobalId, action: 'DISMISS' } }).catch(() => {});

  if (loading) {
    return (
      <Page>
        <h1 className={styles.heading}>Loading…</h1>
      </Page>
    );
  }

  // Checked BEFORE the not-found branch below — the same ordering
  // `page/series` and `page/book` both use, each citing the other: a
  // transport failure also leaves `book` `undefined`, and OR-ing it into the
  // not-found branch would misreport a network failure as the book
  // genuinely not existing.
  if (error !== undefined) {
    return (
      <Page>
        <h1 className={styles.heading}>Failed to load book.</h1>
      </Page>
    );
  }

  if (book === undefined) {
    return (
      <Page>
        <h1 className={styles.heading}>Book not found.</h1>
      </Page>
    );
  }

  if (book.validation?.valid !== true) {
    return (
      <Page>
        <h1 className={styles.heading}>This book must pass validation before it can be edited.</h1>
      </Page>
    );
  }

  return (
    <Page>
      {hasPendingConflict ? (
        <UploadFixGuardModal
          isOpen
          onReview={() => navigate(path.upload())}
          onDismissAndEdit={() => void dismissPendingFixes(book.id)}
          onCancel={() => navigate(path.library())}
        />
      ) : (
        <BookEditForm key={id} book={book} />
      )}
    </Page>
  );
};
