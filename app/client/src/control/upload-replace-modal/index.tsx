import { useCallback, useMemo, useState } from 'react';

import { CardDivider } from '~/component/card-divider';
import { FixReview } from '~/component/fix-review';
import { UploadZone } from '~/component/upload-zone';
import { CheckIcon } from '~/icon';
import type { MetadataFix, ReplaceAnalysis } from '~/lib/book-types';
import { fixKey } from '~/provider/upload';

import { ConfirmModal } from '../confirm-modal';
import { useStyle } from './style';
import { useReplaceBook } from './use-replace-book';

interface Props {
  isOpen: boolean;
  /** Already a Relay GLOBAL id (`Book.id`, `Book implements Node`) — the
   * `BookAnalyzeReplace`/`BookReplace` mutations this modal drives both take
   * that id verbatim, nothing to convert. */
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  /** `newId` is `commitReplacement`'s resolved `book.id` — already the Relay
   * GLOBAL id for the post-replace book, straight off `BookReplacePayload`
   * (2026-08-13 final review, C-2 — human ruling, Option 1). */
  onReplaced: (newId: string) => void;
}

/**
 * NO `SeverityCounts` (task 10, GraphQL migration): the REST-era analysis
 * response carried `counts`/`threshold`, but `BookAnalyzeReplacePayload`
 * (`graphql/upload.ts`) does not — it resolves only `valid`, `autoFixes`,
 * `proposals` (plus an unselected `messages: [EpubValidationMessage!]!`,
 * deliberately not selected since this modal doesn't render epubcheck
 * findings either). This is a real, forced behavior change, not an
 * oversight: the severity breakdown chips this modal used to show next to
 * "Book is valid"/"Book is not valid" are gone because the schema this
 * mutation exposes has no equivalent aggregate field to show them from.
 */
export function UploadReplaceModal({ isOpen, bookId, bookTitle, onClose, onReplaced }: Props) {
  const styles = useStyle();
  const { analyzeReplacement, commitReplacement, analyzing, committing, commitError } =
    useReplaceBook();
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ReplaceAnalysis | null>(null);
  const [accepted, setAccepted] = useState<MetadataFix[]>([]);
  const [rejectedKeys, setRejectedKeys] = useState<Set<string>>(new Set());
  const [commitFailed, setCommitFailed] = useState(false);

  const remainingProposals = useMemo(() => {
    const acceptedKeys = new Set(accepted.map(fixKey));
    return (analysis?.proposals ?? []).filter(
      (p) => !acceptedKeys.has(fixKey(p)) && !rejectedKeys.has(fixKey(p))
    );
  }, [analysis, accepted, rejectedKeys]);

  // Block Replace until every actionable suggested fix (one with a concrete `to`
  // value) has been accepted or rejected. Flag-only "needs review" proposals
  // (to === null) can't be accepted and have no per-row action here, so they
  // don't gate the button.
  const hasPendingFixes = remainingProposals.some((p) => p.to !== null);

  const pick = useCallback(
    async (files: FileList) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setAnalysis(null);
      setAccepted([]);
      setRejectedKeys(new Set());
      setCommitFailed(false);
      const a = await analyzeReplacement(bookId, f);
      setAnalysis(a ?? null);
    },
    [bookId, analyzeReplacement]
  );

  const reset = useCallback(() => {
    setFile(null);
    setAnalysis(null);
    setAccepted([]);
    setRejectedKeys(new Set());
    setCommitFailed(false);
  }, []);

  const onApplyFix = useCallback((fix: MetadataFix) => {
    setAccepted((prev) => [...prev, fix]);
  }, []);

  const onDismissFix = useCallback((fix: MetadataFix) => {
    setRejectedKeys((prev) => new Set(prev).add(fixKey(fix)));
  }, []);

  const onApplyAll = useCallback(() => {
    setAccepted((prev) => {
      const existing = new Set(prev.map(fixKey));
      const toAdd = remainingProposals.filter((p) => p.to !== null && !existing.has(fixKey(p)));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [remainingProposals]);

  const onDismissAll = useCallback(() => {
    setRejectedKeys((prev) => {
      const next = new Set(prev);
      remainingProposals.forEach((p) => next.add(fixKey(p)));
      return next;
    });
  }, [remainingProposals]);

  const handleConfirm = useCallback(async () => {
    if (!file) return;
    setCommitFailed(false);
    // No `file` argument here: `analyzeReplacement` already staged the bytes
    // over the sanctioned staging seam (`~/lib/staged-upload`) and
    // `commitReplacement` carries that SAME staged id forward internally —
    // see `./use-replace-book.ts`'s doc comment.
    const updated = await commitReplacement(bookId, accepted.map(fixKey));
    if (updated) {
      reset();
      // `updated.id` is already the Relay GLOBAL id (`BookReplacePayload.book.id`,
      // `Book implements Node`) — nothing to convert.
      onReplaced(updated.id);
    } else {
      setCommitFailed(true);
    }
  }, [file, bookId, commitReplacement, accepted, onReplaced, reset]);

  const handleCancel = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  return (
    <ConfirmModal
      isOpen={isOpen}
      title={`Replace "${bookTitle}"`}
      confirmText="Replace"
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      loading={committing}
      confirmDisabled={analysis?.valid !== true || hasPendingFixes}
    >
      {!file && (
        <UploadZone multiple={false} card={false} dropLabel="replacement" addFiles={pick} />
      )}
      {file && (
        <>
          <div className={styles.fileName}>{file.name}</div>

          {analyzing && <p className={styles.muted}>Validating…</p>}

          {!analyzing && analysis && analysis.valid && (
            <>
              <CardDivider>Validation</CardDivider>
              <p className={styles.validLine}>
                <CheckIcon width={15} height={15} className={styles.checkIcon} aria-hidden />
                Book is valid
              </p>
              <FixReview
                autoFixes={analysis.autoFixes}
                appliedFixes={accepted}
                proposals={remainingProposals}
                onApplyFix={onApplyFix}
                onApplyAll={onApplyAll}
                onDismissFix={onDismissFix}
                onDismissAll={onDismissAll}
                disabled={committing}
                showEditLink={false}
              />
              {commitFailed && <p className={styles.error}>{commitError || 'Replace failed.'}</p>}
            </>
          )}

          {!analyzing && analysis && !analysis.valid && (
            <>
              <CardDivider>Validation</CardDivider>
              <p className={styles.invalidLine}>Book is not valid</p>
            </>
          )}

          {!analyzing && analysis === null && (
            <p className={styles.error}>Couldn&apos;t validate this file.</p>
          )}
        </>
      )}
    </ConfirmModal>
  );
}
