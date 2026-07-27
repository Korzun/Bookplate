import { useCallback, useMemo, useState } from 'react';

import { CardDivider, FixReview, UploadZone } from '~/component';
import { CheckIcon } from '~/icon';
import type { MetadataFix, ReplaceAnalysis } from '~/provider/book';
import { useReplaceBook } from '~/provider/book';

import { ConfirmModal } from '../confirm-modal';
import { SeverityCounts } from '../severity-counts';
import { useStyle } from './style';

interface Props {
  isOpen: boolean;
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onReplaced: (newId: string) => void;
}

/** Fixes have no server id — matched by field:kind:from, mirroring the
 * upload queue's `fixKey` so accepted keys line up on the server side. */
const fixKey = (fix: MetadataFix): string => `${fix.field}:${fix.kind}:${fix.from}`;

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
    const updated = await commitReplacement(bookId, file, accepted.map(fixKey));
    if (updated) {
      reset();
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
      confirmDisabled={analysis?.valid !== true}
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
              <SeverityCounts counts={analysis.counts} threshold={analysis.threshold} />
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
              <SeverityCounts counts={analysis.counts} threshold={analysis.threshold} />
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
