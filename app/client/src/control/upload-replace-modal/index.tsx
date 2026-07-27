import { useCallback, useState } from 'react';

import { UploadZone } from '~/component';
import type { ValidationReport } from '~/lib/severity';
import { useReplaceBook } from '~/provider/book';

import { ConfirmModal } from '../confirm-modal';
import { SeverityCounts } from '../severity-counts';

interface Props {
  isOpen: boolean;
  bookId: string;
  bookTitle: string;
  onClose: () => void;
  onReplaced: (newId: string) => void;
}

export function UploadReplaceModal({ isOpen, bookId, bookTitle, onClose, onReplaced }: Props) {
  const { validateReplacement, commitReplacement, validating, committing } = useReplaceBook();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  const pick = useCallback(
    async (files: FileList) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setReport(null);
      const r = await validateReplacement(bookId, f);
      setReport(r ?? null);
    },
    [bookId, validateReplacement]
  );

  const reset = useCallback(() => {
    setFile(null);
    setReport(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file) return;
    const updated = await commitReplacement(bookId, file);
    if (updated) {
      reset();
      onReplaced(updated.id);
    }
  }, [file, bookId, commitReplacement, onReplaced, reset]);

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
      confirmDisabled={report?.valid !== true}
    >
      {!file && <UploadZone multiple={false} addFiles={pick} />}
      {file && validating && <p>Validating {file.name}…</p>}
      {file && !validating && report && report.valid && (
        <div>
          <p>✓ {file.name} is valid.</p>
          <SeverityCounts counts={report.counts} threshold={report.threshold} />
        </div>
      )}
      {file && !validating && report && !report.valid && (
        <div>
          <p>{file.name} failed validation and can&apos;t replace this book.</p>
          <SeverityCounts counts={report.counts} threshold={report.threshold} />
        </div>
      )}
      {file && !validating && report === null && (
        <p>Couldn&apos;t validate {file.name}. Try another file.</p>
      )}
    </ConfirmModal>
  );
}
