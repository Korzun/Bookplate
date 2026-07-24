import { useCallback } from 'react';

import { Button } from '~/control/button';
import { useModalDialog } from '~/control/use-modal-dialog';

import { useStyle } from './style';

type UploadFixGuardModalProps = {
  isOpen: boolean;
  onReview: () => void;
  onDismissAndEdit: () => void;
  onCancel: () => void;
};

/** Shown when the book being edited still has upload fixes pending. Forces a
 * decision so the edit form and the queue can't silently diverge. ESC/backdrop
 * route to `onCancel` (a neutral exit) — never a silent reveal of the form. */
export function UploadFixGuardModal({
  isOpen,
  onReview,
  onDismissAndEdit,
  onCancel,
}: UploadFixGuardModalProps) {
  const styles = useStyle();
  const modalRef = useModalDialog(isOpen, onCancel);

  const handleBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      event.stopPropagation();
      onCancel();
    },
    [onCancel]
  );
  const stop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation(),
    []
  );

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleBackdrop}>
      <div className={styles.dialog} onClick={stop}>
        <div className={styles.header}>Fixes waiting for this book</div>
        <div className={styles.body}>
          This book has metadata fixes from its upload that you haven&apos;t reviewed yet. Editing
          it now could overwrite them. Review the fixes first, or dismiss them to edit directly.
        </div>
        <div className={styles.footer}>
          <Button onClick={onDismissAndEdit} type="text" radius="modal">
            Dismiss fixes &amp; edit
          </Button>
          <Button onClick={onReview} type="primary" radius="modal">
            Review fixes
          </Button>
        </div>
      </div>
    </dialog>
  );
}
