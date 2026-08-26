import { useQuery } from '@apollo/client/react';
import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { graphql } from '~/gql';
import { useCurrentLibraryId } from '~/provider/library-target';
import { useFixActions } from '~/provider/upload';
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
 * **Cost (`npm run test:cost -w app/server`): breadth 46 (46.0%) → 40
 * (40.0%), complexity 46 → 40.** MEASURED, not estimated — three changes,
 * measured together:
 *   - `documentId` removed — selected before Task 8, rendered by nothing: −1.
 *   - `pendingFix.state.proposals` trimmed from the full 8-field
 *     `MetadataFix` shape to `{ to }` alone: −7. The guard below is the ONLY
 *     reader, and all it asks is whether any remaining proposal has a
 *     concrete `to`; the modal it gates takes no data props at all.
 *   - `...BookEditFormFragment`: **+2**, not the +1 spec §4.0 predicts.
 *     Codegen injects `__typename` both into the spread and into the
 *     wrapping selection set and the cost walker counts both; here it lands
 *     at +2. If you change this document, re-measure rather than deriving
 *     from §4.0's figure.
 *
 * One consequence of the `proposals` trim, recorded because it is invisible
 * otherwise: this document now writes a PARTIAL `MetadataFix` into the shared
 * `PendingFix:<id>` cache entity. `page/upload`'s `LibraryPendingFixes` reads
 * the full shape off its own `Library.pendingFixes` field, which this
 * document never writes, so no read is served a half-populated proposal — at
 * worst a later read misses the cache and goes to the network, which is what
 * it would have done anyway.
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
          pendingFix {
            id
            state {
              proposals {
                to
              }
            }
          }
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
  // page's own query (`BookEditDocument`'s `book.pendingFix`) instead of a
  // separate queue-keyed lookup.
  // A live row with no proposals left (fully resolved, undo still armed
  // within the TTL) is not a conflict. Neither is one whose every remaining
  // proposal is ADVISORY (`to === null`, "needs review"): the guard exists
  // because editing could overwrite a concrete pending suggestion, and an
  // advisory fix has no suggested value to overwrite. It is also the only
  // kind `FixReview` resolves by linking HERE — `bookResolvePendingFix`'s
  // ACCEPT filters to `to !== null` and leaves advisory proposals behind, so
  // they can never be cleared by accepting. Guarding on them bounced the user
  // straight back to the screen whose Edit link sent them, with no way out.
  // Same rule `control/upload-replace-modal` already applies to gate Replace.
  // `to` is the ONLY proposal field this document selects, precisely because
  // it is the only one this line reads.
  const pendingItem =
    book?.pendingFix && book.pendingFix.state.proposals.some((p) => p.to !== null)
      ? book.pendingFix
      : undefined;
  // `useFixActions` directly, not `useUploadQueue()`: the dismiss action
  // only ever needs this book's own GLOBAL id (`book.id`, always in hand
  // here), never the queue's per-render item id — see this task's report
  // for the id-mismatch a queue-routed dismiss would have risked for a
  // book whose upload is still a live transport item in this tab. This is
  // also what drops the page's dependency on `UploadProvider` entirely, not
  // merely for conflict detection.
  const { dismissFixes } = useFixActions();

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
      {pendingItem ? (
        <UploadFixGuardModal
          isOpen
          onReview={() => navigate(path.upload())}
          onDismissAndEdit={() => void dismissFixes(book.id)}
          onCancel={() => navigate(path.library())}
        />
      ) : (
        <BookEditForm key={id} book={book} />
      )}
    </Page>
  );
};
