import { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteMyProgress, useSetMyProgress } from '~/provider/progress';

import { Button } from '../button';
import { ProportionalChapterSlider } from '../proportional-chapter-slider';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type SetProgressModalProps = {
  isOpen: boolean;
  /**
   * RAW content hash — the key `ProgressProvider`'s REST map uses
   * (`Progress.document`, `use-fetch-my-progress-list.ts`'s `merged[p.
   * document] = p`). Both `useSetMyProgress` and `useDeleteMyProgress` write
   * and look up against this exact string; NEVER pass a Relay global id
   * here (2026-08-13 final review, C-1/I-1) — `page/book`'s `Book.id` — a
   * global id would silently miss every existing REST progress row (delete
   * finds nothing to clear) and, on save, create a phantom second row keyed
   * by the wrong id (`MyProgressContent` renders one row per map entry,
   * so a save under the wrong key duplicates the book in the profile list
   * for the rest of the session). Use `Book.documentId`.
   */
  documentId: string;
  chapterCount: number;
  initialChapter: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  onClose: () => void;
  /**
   * STEP-8 BRIDGE — delete this when the progress hooks move to GraphQL.
   * `SetProgressModal` writes through `ProgressProvider` (REST); this page reads
   * `Book.progress` from the Apollo cache. Nothing connects the two, so without
   * this refetch a save leaves the displayed percentage stale until a reload.
   * Once `progressSet` is a GraphQL mutation its payload normalizes onto the same
   * `Progress` entity and this prop, and the refetch, become dead weight.
   */
  onSaved?: () => void;
};

export function SetProgressModal({
  isOpen,
  documentId,
  chapterCount,
  initialChapter,
  chapterSpineMap = [],
  chapterNames = [],
  onClose,
  onSaved,
}: SetProgressModalProps) {
  const styles = useStyle();
  const [selectedChapter, setSelectedChapter] = useState(initialChapter);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  const [setMyProgress, saving, saveError, saveErrorMessage] = useSetMyProgress(documentId);
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
      if (!hasError) {
        onSaved?.();
        onClose();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusy, hasError]);

  const handleConfirm = useCallback(() => {
    pendingRef.current = true;
    wasBusyRef.current = false;
    if (selectedChapter === 0) {
      deleteMyProgress(documentId);
    } else if (selectedChapter > chapterCount) {
      setMyProgress({ currentChapter: chapterCount, percentage: 1.0 });
    } else {
      setMyProgress({
        currentChapter: selectedChapter,
        percentage: selectedChapter / chapterCount,
      });
    }
  }, [selectedChapter, documentId, chapterCount, setMyProgress, deleteMyProgress]);

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
