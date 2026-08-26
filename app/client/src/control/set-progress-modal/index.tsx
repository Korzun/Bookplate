import { useCallback, useEffect, useRef, useState } from 'react';

import { useDeleteProgress, useSetMyProgress } from '~/lib/use-progress-mutations';

import { Button } from '../button';
import { ProportionalChapterSlider } from '../proportional-chapter-slider';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type SetProgressModalProps = {
  isOpen: boolean;
  /**
   * RAW content hash — `progressSet`'s `document` input (`Progress.document`
   * — see `graphql/progress.ts`'s `ProgressRowFragment` doc comment).
   * `useSetMyProgress` writes against this exact string; NEVER pass a Relay
   * global id here (2026-08-13 final review, C-1/I-1) — `page/book`'s
   * `Book.id` — the server resolves `document` as a raw content hash, not a
   * global id. Use `Book.documentId`.
   */
  documentId: string;
  /**
   * The Relay global `Progress.id` for this book's own row, when one exists
   * — `page/book` passes `book.progress?.id` (`BookDetailDocument` already
   * selects it). `useDeleteProgress` takes this, NOT `documentId` or
   * `Book.id`: `progressDelete` authorises the DECODED owner the id itself
   * carries, so the wrong KIND of id either 404s or (worse) targets a
   * different row entirely. `undefined` whenever the book has no progress
   * row yet — "Clear Progress" is unreachable in that state anyway (see
   * `isClearing` below, gated on `hasExistingProgress`), so `handleConfirm`
   * guards on it defensively rather than asserting it's always present.
   */
  progressId?: string;
  chapterCount: number;
  initialChapter: number;
  chapterSpineMap?: number[];
  chapterNames?: string[];
  onClose: () => void;
};

export function SetProgressModal({
  isOpen,
  documentId,
  progressId,
  chapterCount,
  initialChapter,
  chapterSpineMap = [],
  chapterNames = [],
  onClose,
}: SetProgressModalProps) {
  const styles = useStyle();
  const [selectedChapter, setSelectedChapter] = useState(initialChapter);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  const { setProgress, saving, error: saveError } = useSetMyProgress(documentId);
  const { deleteProgress, deleting, error: deleteError } = useDeleteProgress();

  const isBusy = saving || deleting;
  const hasError = saveError !== undefined || deleteError !== undefined;
  const errorText = saveError ?? deleteError;

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
        onClose();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBusy, hasError]);

  const handleConfirm = useCallback(() => {
    if (selectedChapter === 0) {
      // See `progressId`'s own doc comment — "Clear Progress" is disabled
      // (via `isNoop`) whenever there is no existing progress to clear, so
      // this is only reachable when `progressId` is defined; guarded here
      // rather than asserted.
      if (progressId === undefined) return;
      pendingRef.current = true;
      wasBusyRef.current = false;
      void deleteProgress(progressId);
    } else {
      pendingRef.current = true;
      wasBusyRef.current = false;
      if (selectedChapter > chapterCount) {
        void setProgress({ currentChapter: chapterCount, percentage: 1.0 });
      } else {
        void setProgress({
          currentChapter: selectedChapter,
          percentage: selectedChapter / chapterCount,
        });
      }
    }
  }, [selectedChapter, progressId, chapterCount, setProgress, deleteProgress]);

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
