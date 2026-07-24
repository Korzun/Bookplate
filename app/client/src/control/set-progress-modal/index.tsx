import { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteMyProgress, useSetMyProgress } from '~/provider/progress';

import { Button } from '../button';
import { ProportionalChapterSlider } from '../proportional-chapter-slider';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type SetProgressModalProps = {
  isOpen: boolean;
  bookId: string;
  chapterCount: number;
  initialChapter: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  onClose: () => void;
};

export function SetProgressModal({
  isOpen,
  bookId,
  chapterCount,
  initialChapter,
  chapterSpineMap = [],
  chapterNames = [],
  onClose,
}: SetProgressModalProps) {
  const styles = useStyle();
  const [selectedChapter, setSelectedChapter] = useState(initialChapter);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  const [setMyProgress, saving, saveError, saveErrorMessage] = useSetMyProgress(bookId);
  const [deleteMyProgress, deleting, deleteError, deleteErrorMessage] = useDeleteMyProgress();

  const isBusy = saving || deleting;
  const hasError = saveError || deleteError;
  const errorText = saveErrorMessage ?? deleteErrorMessage;

  // Refs to track the busy transition so we can close after a successful operation
  const pendingRef = useRef(false);
  const wasBusyRef = useRef(false);

  // Close when the API call completes without error
  useEffect(() => {
    if (!pendingRef.current) return;
    if (isBusy) {
      wasBusyRef.current = true;
      return;
    }
    if (wasBusyRef.current) {
      wasBusyRef.current = false;
      pendingRef.current = false;
      if (!hasError) onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusy, hasError]);

  const handleConfirm = useCallback(() => {
    pendingRef.current = true;
    wasBusyRef.current = false;
    if (selectedChapter === 0) {
      deleteMyProgress(bookId);
    } else if (selectedChapter > chapterCount) {
      setMyProgress({ currentChapter: chapterCount, percentage: 1.0 });
    } else {
      setMyProgress({
        currentChapter: selectedChapter,
        percentage: selectedChapter / chapterCount,
      });
    }
  }, [selectedChapter, bookId, chapterCount, setMyProgress, deleteMyProgress]);

  const handleCancel = useCallback(() => onClose(), [onClose]);
  // Escape dismisses the modal the same way the Cancel button does.
  const modalRef = useModalDialog(isOpen, handleCancel);

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

  const hasExistingProgress = initialChapter > 0;
  const isClearing = selectedChapter === 0 && hasExistingProgress;
  const isNoop = selectedChapter === 0 && !hasExistingProgress;
  const isCompleted = selectedChapter > chapterCount;
  const activeName =
    !isSliderDragging && selectedChapter > 0 && !isCompleted
      ? (chapterNames[selectedChapter - 1] ?? '')
      : '';

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Set Progress</div>
        <div className={styles.chapterDisplay}>
          <div className={isClearing ? styles.chapterNumberMuted : styles.chapterNumber}>
            {isClearing ? 'Not started' : isCompleted ? 'Completed' : `Chapter ${selectedChapter}`}
          </div>
          <div className={styles.chapterName}>{activeName}</div>
          <div className={styles.chapterSubtitle}>of {chapterCount} chapters</div>
        </div>
        <div className={styles.sliderSection}>
          <ProportionalChapterSlider
            value={selectedChapter}
            onChange={setSelectedChapter}
            chapterCount={chapterCount}
            chapterSpineMap={chapterSpineMap}
            disabled={isBusy}
            onDragChange={setIsSliderDragging}
          />
        </div>
        {hasError && (
          <div className={styles.error}>
            {errorText ?? 'Something went wrong. Please try again.'}
          </div>
        )}
        <div className={styles.footer}>
          <Button type="text" onClick={handleCancel} radius="modal">
            Cancel
          </Button>
          <Button
            type="primary"
            danger={isClearing}
            loading={isBusy}
            disabled={isBusy || isNoop}
            onClick={handleConfirm}
            radius="modal"
          >
            {isClearing ? 'Clear Progress' : isCompleted ? 'Mark Complete' : 'Save Progress'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
