import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import { BookEditForm, Page } from '~/component';
import { UploadFixGuardModal } from '~/component/upload-fix-guard-modal';
import { useBook } from '~/provider/book';
import { useToast } from '~/provider/toast';
import { usePendingFixesForBook, useUploadQueue } from '~/provider/upload';
import { path } from '~/router';

import { useStyle } from './style';

export const BookEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const styles = useStyle();
  const showToast = useToast();
  const navigate = useNavigate();
  const lastErrorRef = useRef<string | undefined>(undefined);

  const [original, loading, hasError, errorMessage] = useBook(id!);
  // `original.id` — the RAW, resolved id `useBook` already looked up — not
  // the bare `id` URL param. `usePendingFixesForBook` matches against
  // `item.bookId` (`use-pending-fixes-for-book.ts`), which the upload queue
  // always keys by raw id; `id` here can be a Relay global id (a grid link,
  // once one exists to `/book/<globalId>/edit`), which would never match
  // and silently miss a real pending-fix conflict. `original` isn't defined
  // yet on the first render while `useBook` is still loading — passing
  // `undefined` is correct there too: `usePendingFixesForBook` already
  // treats a missing id as "no conflict" until there's a real raw id to
  // check.
  const pendingItem = usePendingFixesForBook(original?.id);
  const { dismissAllProposals } = useUploadQueue();

  useEffect(() => {
    if (errorMessage !== undefined && errorMessage !== lastErrorRef.current) {
      lastErrorRef.current = errorMessage;
      showToast(errorMessage, 'error');
    }
  }, [errorMessage, showToast]);

  if (loading) {
    return (
      <Page>
        <h1 className={styles.heading}>Loading…</h1>
      </Page>
    );
  }

  if (!original) {
    return (
      <Page>
        <h1 className={styles.heading}>
          {hasError ? (errorMessage ?? 'Failed to load book.') : 'Book not found.'}
        </h1>
      </Page>
    );
  }

  if (original.valid !== true) {
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
        // `bookGlobalId={id!}` — the bare URL param, NOT `original.id`
        // (2026-08-13 final review, C-2): `page/book` only ever links here
        // via `path.bookEdit(book.id)`, a Relay global id, so the param this
        // page was reached with is already the right kind for `BookEditForm`'s
        // own Cancel-button navigation back to `path.book(...)`.
        <BookEditForm key={id} original={original} id={original.id} bookGlobalId={id!} />
      )}
    </Page>
  );
};
