import { Fragment, useCallback, useState } from 'react';

import { DeviceIcon } from '~/icon';
import { useBook, useClearBookEditions } from '~/provider/book';
import { useToast } from '~/provider/toast';

import { Button, ButtonRadiusValue } from '../button';
import { ConfirmModal } from '../confirm-modal';

interface ClearEditionsButton {
  bookId: string;
  radius?: ButtonRadiusValue;
}

export function ClearEditionsButton({ bookId, radius }: ClearEditionsButton) {
  const [book] = useBook(bookId);
  const [clearBookEditions, clearing] = useClearBookEditions();
  const showToast = useToast();
  const [showModal, setShowModal] = useState(false);
  const count = book?.deviceEditionCount ?? 0;

  const handleOpen = useCallback(() => {
    if (count > 0) setShowModal(true);
  }, [count]);
  const handleCancel = useCallback(() => setShowModal(false), []);
  const handleConfirm = useCallback(async () => {
    setShowModal(false);
    const cleared = await clearBookEditions(bookId);
    if (cleared === undefined) {
      showToast('Failed to clear device editions', 'error');
      return;
    }
    showToast(`Cleared ${cleared} device edition${cleared === 1 ? '' : 's'}`, 'success');
  }, [clearBookEditions, bookId, showToast]);

  return (
    <Fragment>
      <Button onClick={handleOpen} disabled={count === 0} radius={radius}>
        Clear editions ({count})
      </Button>
      <ConfirmModal
        icon={DeviceIcon}
        isOpen={showModal}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title="Clear device editions?"
        confirmText="Clear editions"
        loading={clearing}
      >
        All cached device editions for this book will be removed. They&apos;ll be regenerated the
        next time each device downloads it.
      </ConfirmModal>
    </Fragment>
  );
}
