import { useCallback, useState } from 'react';

import { UploadZone } from '~/component';
import { CheckIcon } from '~/icon';
import type { ValidationReport } from '~/lib/severity';
import { useReplaceBook } from '~/provider/book';

import { Button } from '../button';
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

export function UploadReplaceModal({ isOpen, bookId, bookTitle, onClose, onReplaced }: Props) {
  const styles = useStyle();
  const { validateReplacement, commitReplacement, validating, committing, commitError } =
    useReplaceBook();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [commitFailed, setCommitFailed] = useState(false);

  const pick = useCallback(
    async (files: FileList) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setReport(null);
      setCommitFailed(false);
      const r = await validateReplacement(bookId, f);
      setReport(r ?? null);
    },
    [bookId, validateReplacement]
  );

  const reset = useCallback(() => {
    setFile(null);
    setReport(null);
    setCommitFailed(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file) return;
    setCommitFailed(false);
    const updated = await commitReplacement(bookId, file);
    if (updated) {
      reset();
      onReplaced(updated.id);
    } else {
      setCommitFailed(true);
    }
  }, [file, bookId, commitReplacement, onReplaced, reset]);

  const handleCancel = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const chooseDifferentFile = (
    <Button type="link" onClick={reset}>
      Choose a different file
    </Button>
  );

  return (
    <ConfirmModal
      isOpen={isOpen}
      title={`Replace "${bookTitle}"`}
      confirmText="Replace"
      onCancel={handleCancel}
      onConfirm={handleConfirm}
      loading={committing}
      confirmDisabled={report?.valid !== true}
    >
      {!file && <UploadZone multiple={false} addFiles={pick} />}
      {file && validating && <p>Validating {file.name}…</p>}
      {file && !validating && report && report.valid && (
        <div>
          <p className={styles.validLine}>
            <CheckIcon width={16} height={16} className={styles.checkIcon} aria-hidden />
            {file.name} is valid.
          </p>
          <SeverityCounts counts={report.counts} threshold={report.threshold} />
          {commitFailed && <p>{commitError || 'Replace failed.'}</p>}
          {chooseDifferentFile}
        </div>
      )}
      {file && !validating && report && !report.valid && (
        <div>
          <p>{file.name} failed validation and can&apos;t replace this book.</p>
          <SeverityCounts counts={report.counts} threshold={report.threshold} />
          {chooseDifferentFile}
        </div>
      )}
      {file && !validating && report === null && (
        <div>
          <p>Couldn&apos;t validate {file.name}. Try another file.</p>
          {chooseDifferentFile}
        </div>
      )}
    </ConfirmModal>
  );
}
