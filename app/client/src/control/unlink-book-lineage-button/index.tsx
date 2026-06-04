import { Fragment, useCallback, useState } from 'react';

import { AlertOctagonIcon } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { useBook, useUnlinkBookLineage } from '~/provider/book';

import { Button, type ButtonTypeValue } from '../button';
import { ConfirmModal } from '../confirm-modal';

import { useStyle } from './style';

interface UnlinkBookLineageButtonProps {
  bookId: string;
  buttonType?: ButtonTypeValue;
  documentId: string;
  onSuccess?: () => void;
}

export const UnlinkBookLineageButton = ({
  bookId,
  buttonType,
  documentId,
  onSuccess,
}: UnlinkBookLineageButtonProps) => {
  const style = useStyle();

  const [isAdmin] = useIsAdmin();

  const [book] = useBook(bookId);
  const [unlink, unlinking] = useUnlinkBookLineage(bookId);
  const [showUnlinkModal, setShowUnlinkModal] = useState<boolean>(false);
  const handleUnlink = useCallback(() => {
    if (!book) {
      return;
    }
    setShowUnlinkModal(true);
  }, [book]);
  const handleUnlinkCancel = useCallback(() => {
    setShowUnlinkModal(false);
  }, []);
  const handleUnlinkConfirm = useCallback(async () => {
    setShowUnlinkModal(false);
    if (!book) {
      return;
    }
    const success = await unlink(documentId);
    if (success) onSuccess?.();
  }, [book, documentId, unlink, onSuccess]);

  if (!isAdmin) {
    return null;
  }

  return (
    <Fragment>
      <Button type={buttonType} onClick={handleUnlink} danger>
        unlink
      </Button>
      <ConfirmModal
        icon={AlertOctagonIcon}
        isOpen={showUnlinkModal}
        onCancel={handleUnlinkCancel}
        onConfirm={handleUnlinkConfirm}
        danger
        title={`Unlink document?`}
        confirmText="Unlink"
        loading={unlinking}
      >
        This action will unlink <span className={style.document}>{documentId}</span> from{' '}
        <span className={style.book}>{book?.title ?? 'book'}</span> leaving all progress behind.
      </ConfirmModal>
    </Fragment>
  );
};
