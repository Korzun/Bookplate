import { Fragment, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AlertOctagonIcon } from '~/icon';
import { useBook, useDeleteBook } from '~/provider/book';
import { path } from '~/router';

import { Button } from '../button';
import { ConfirmModal } from '../confirm-modal';

import { useStyle } from './style';

interface DeleteBookButton {
  bookId: string;
}

export function DeleteBookButton({ bookId }: DeleteBookButton) {
  const style = useStyle();

  const navigate = useNavigate();

  const [book] = useBook(bookId);
  const [deleteBook, deleting] = useDeleteBook();
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const handleDelete = useCallback(() => {
    if (!book) {
      return;
    }
    setShowDeleteModal(true);
  }, [book]);
  const handleDeleteCancel = useCallback(() => {
    setShowDeleteModal(false);
  }, []);
  const handleDeleteConfirm = useCallback(async () => {
    setShowDeleteModal(false);
    if (!book) {
      return;
    }
    await deleteBook(book.id);
    navigate(path.home());
  }, [deleteBook, book, navigate]);

  return (
    <Fragment>
      <Button onClick={handleDelete} danger>
        Delete book
      </Button>
      <ConfirmModal
        icon={AlertOctagonIcon}
        isOpen={showDeleteModal}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        danger
        title={`Delete book permanently?`}
        confirmText="Delete"
        loading={deleting}
      >
        This action will delete <span className={style.book}>{book?.title ?? 'book'}</span> from all
        user libraries, along with any synced progress, and{' '}
        <span className={style.undone}>can not be undone</span>.
      </ConfirmModal>
    </Fragment>
  );
}
