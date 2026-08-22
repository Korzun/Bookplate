import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { useBookEdit } from '~/provider/book';
import { usePendingFixesForBook, useUploadQueue } from '~/provider/upload';
import { path } from '~/router';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const navigate = useNavigate();

  const { book, loading, error } = useBookEdit(id!);
  // `book?.documentId` — the RAW content hash `BookEditDocument` resolves —
  // not `book?.id`/the URL param (both Relay GLOBAL ids). The upload queue
  // always keys its items by the raw id (`use-pending-fixes-for-book.ts`
  // matches against `item.bookId`), so feeding it a global id would silently
  // miss a real pending-fix conflict. `book` isn't defined yet on the first
  // render while `useBookEdit` is still loading — passing `undefined` is
  // correct there too: `usePendingFixesForBook` already treats a missing id
  // as "no conflict" until there's a real raw id to check.
  const pendingItem = usePendingFixesForBook(book?.documentId);
  const { dismissAllProposals } = useUploadQueue();

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
          onDismissAndEdit={() => dismissAllProposals(pendingItem.id)}
          onCancel={() => navigate(path.library())}
        />
      ) : (
        <BookEditForm key={id} book={book} />
      )}
    </Page>
  );
};
