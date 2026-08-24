import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { useBookEdit } from '~/provider/book';
import { useFixActions } from '~/provider/upload';
import { path } from '~/router';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const navigate = useNavigate();

  const { book, loading, error } = useBookEdit(id!);
  // The book-edit page's own pending-fix conflict, read straight off this
  // page's own query (`BookEditDocument`'s `book.pendingFix`, Task 11 —
  // controller ruling R3) instead of a separate queue-keyed lookup
  // (`usePendingFixesForBook`, deleted this task — it had exactly one
  // consumer, this page, and this document already loads the whole book).
  // A live row with no proposals left (fully resolved, undo still armed
  // within the TTL) is not a conflict — only a non-empty `proposals` list
  // is.
  const pendingItem =
    book?.pendingFix && book.pendingFix.state.proposals.length > 0 ? book.pendingFix : undefined;
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
