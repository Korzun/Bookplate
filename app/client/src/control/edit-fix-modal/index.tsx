import { useCallback, useState } from 'react';

import type { MetadataFix } from '~/lib/book-types';
import { labelForFix } from '~/lib/metadata-fix-label';

import { Button } from '../button';
import { TextInput } from '../text-input';
import { useModalDialog } from '../use-modal-dialog';
import { useStyle } from './style';

type EditFixModalProps = {
  isOpen: boolean;
  /** The flagged ("needs review") proposal. Its `from` is the field's
   * current value, which is what the input starts with. */
  fix: MetadataFix;
  /** Resolves `true` once the value is written; `false` keeps the modal
   * open so the user can retry or back out. */
  onSave: (fix: MetadataFix, value: string) => Promise<boolean>;
  /** "Keep as is": the flagged value is fine, drop the flag. */
  onKeep: (fix: MetadataFix) => void;
  onClose: () => void;
};

/**
 * Edits the one field a "needs review" proposal flagged, in place, instead
 * of sending the user to the full edit page. Saving resolves the proposal
 * through `bookResolvePendingFix`'s EDIT action (the upload queue's
 * `editFix`), so the card shows it as an applied fix with Undo, exactly like
 * an accepted suggestion.
 */
export function EditFixModal({ isOpen, fix, onSave, onKeep, onClose }: EditFixModalProps) {
  const styles = useStyle();
  const label = labelForFix(fix);
  const [value, setValue] = useState(fix.from);
  const [busy, setBusy] = useState(false);

  const trimmed = value.trim();
  // One primary button: "Keep as is" while the value still matches the
  // flagged one (the flag is acknowledged, nothing is written), "Save" once
  // it differs. Empty is neither — it would write nothing meaningful — so
  // the button simply disables.
  const unchanged = trimmed === fix.from.trim();
  const canSave = !busy && trimmed !== '' && !unchanged;

  const handleCancel = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const ok = await onSave(fix, trimmed);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }, [canSave, onSave, fix, trimmed, onClose]);

  const handleKeep = useCallback(() => {
    if (busy) return;
    onKeep(fix);
    onClose();
  }, [busy, onKeep, fix, onClose]);

  const handlePrimary = useCallback(() => {
    if (unchanged) handleKeep();
    else void handleSave();
  }, [unchanged, handleKeep, handleSave]);

  const modalRef = useModalDialog(isOpen, handleCancel, !busy);
  const handleClickBackground = useCallback(
    (event: React.MouseEvent<HTMLDialogElement, MouseEvent>) => {
      event.stopPropagation();
      handleCancel();
    },
    [handleCancel]
  );
  const handleClickDialog = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    event.stopPropagation();
  }, []);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handlePrimary();
      }
    },
    [handlePrimary]
  );

  return (
    <dialog ref={modalRef} className={styles.root} onClick={handleClickBackground}>
      <div className={styles.dialog} onClick={handleClickDialog}>
        <div className={styles.header}>Fix {label}</div>
        <div className={styles.body}>
          {fix.reason && <p className={styles.reason}>{fix.reason}</p>}
          <TextInput
            name={fix.field}
            value={value}
            onChange={(next) => setValue(next ?? '')}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className={styles.footer}>
          <Button onClick={handleCancel} disabled={busy} type="text" radius="modal">
            Cancel
          </Button>
          <Button
            onClick={handlePrimary}
            disabled={unchanged ? busy : !canSave}
            loading={busy}
            type="primary"
            radius="modal"
          >
            {unchanged ? 'Keep as is' : 'Save'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
