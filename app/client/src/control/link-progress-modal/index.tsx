import cx from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBookList } from '~/provider/book';
import { useLinkProgress } from '~/provider/progress';

import { Button } from '../button';

import { useStyle } from './style';

type LinkProgressModalProps = {
  isOpen: boolean;
  documentId: string;
  username: string;
  onClose: () => void;
};

export function LinkProgressModal({
  isOpen,
  documentId,
  username,
  onClose,
}: LinkProgressModalProps) {
  const styles = useStyle();
  const modalRef = useRef<HTMLDialogElement>(null);

  const [books, booksLoading, booksError, booksErrorMessage] = useBookList();
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [link, linking, linkError, linkErrorMessage] = useLinkProgress(
    selectedBookId ?? '',
    username
  );

  const pendingRef = useRef(false);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (isOpen) {
      modal.showModal();
    } else {
      modal.close();
    }
  }, [isOpen]);

  // Close after a successful link
  useEffect(() => {
    if (!pendingRef.current) return;
    if (linking) {
      wasBusyRef.current = true;
      return;
    }
    if (wasBusyRef.current) {
      wasBusyRef.current = false;
      pendingRef.current = false;
      if (!linkError) onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking, linkError]);

  const filteredBooks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    );
  }, [books, filter]);

  const handleConfirm = useCallback(() => {
    if (!selectedBookId) return;
    pendingRef.current = true;
    wasBusyRef.current = false;
    void link(documentId);
  }, [selectedBookId, link, documentId]);

  const handleCancel = useCallback(() => onClose(), [onClose]);

  const handleClickBackground = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      e.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );

  const handleClickDialog = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);

  return (
    <dialog ref={modalRef} className={styles.root} closedby="none" onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Link Progress</div>
        <div className={styles.body}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Filter by title or author…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <ul className={styles.bookList}>
            {booksLoading ? (
              <li className={styles.emptyMessage}>Loading books…</li>
            ) : booksError ? (
              <li className={styles.emptyMessage}>
                {booksErrorMessage ?? 'Failed to load books.'}
              </li>
            ) : filteredBooks.length === 0 ? (
              <li className={styles.emptyMessage}>No books match.</li>
            ) : (
              filteredBooks.map((book) => (
                <li
                  key={book.id}
                  className={cx(styles.bookItem, {
                    [styles.bookItemSelected]: book.id === selectedBookId,
                  })}
                >
                  <button
                    type="button"
                    className={styles.bookItemButton}
                    onClick={() => setSelectedBookId(book.id)}
                  >
                    <div className={styles.bookTitle}>{book.title}</div>
                    {book.author && <div className={styles.bookAuthor}>{book.author}</div>}
                  </button>
                </li>
              ))
            )}
          </ul>
          {linkError && (
            <div className={styles.error}>
              {linkErrorMessage ?? 'Something went wrong. Please try again.'}
            </div>
          )}
        </div>
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            type="primary"
            disabled={!selectedBookId || linking}
            loading={linking}
            onClick={handleConfirm}
          >
            Link
          </Button>
        </div>
      </div>
    </dialog>
  );
}
