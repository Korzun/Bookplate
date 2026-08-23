import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import { ProgressRowFragment } from '~/graphql/progress';
import { AlertOctagonIcon } from '~/icon';
import { useDeleteProgress } from '~/provider/library';
import { useToast } from '~/provider/toast';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';
import { useStyle } from './style';

interface MyProgressRowProps {
  progress: FragmentType<typeof ProgressRowFragment>;
}

/**
 * Fetch-free: renders entirely off the fragment ref its parent
 * (`MyProgressContent`) already fetched as part of `MyProgressList` — no
 * `useBook` (the old REST per-row book lookup) and no `useMyProgress` (the
 * old REST per-row progress lookup). `useFragment` is called exactly once,
 * unconditionally, in this component's own body — see
 * `use-my-progress-list.ts`'s doc comment for why the hook returns a masked
 * ref instead of unmasking centrally.
 *
 * `book` is NULLABLE — a device syncs progress for documents not in this
 * library. That row still renders, using the raw `document` hash in place
 * of a title and with NO Link affordance: the link-to-book workflow
 * (`LinkProgressModal` rewired onto `bookLinkDocument` +
 * `LinkPickerBooksDocument`) is a later task's job (design spec §6), so this
 * row does not offer a way to resolve an orphan — it only shows that one
 * exists, via the same orphan hint icon the REST row used. The REST row's
 * "Link" button (opening `LinkProgressModal`) is dropped here rather than
 * carried forward wired to the old REST-backed modal, which would have kept
 * this component importing `~/provider/progress` — exactly what this
 * migration step is retiring callers of.
 *
 * No `titleSort` preference: `ProgressRowFragment` selects `book { title
 * ... }` only, no sort title — unlike the REST `Book` shape this row used
 * to read via `useBook`.
 */
export const MyProgressRow = ({ progress }: MyProgressRowProps) => {
  const styles = useStyle();
  const row = useFragment(ProgressRowFragment, progress);
  const { deleteProgress, deleting } = useDeleteProgress();
  const showToast = useToast();

  const [showClearModal, setShowClearModal] = useState(false);

  const handleClear = useCallback(() => setShowClearModal(true), []);
  const handleCancelClear = useCallback(() => setShowClearModal(false), []);
  const handleConfirmClear = useCallback(async () => {
    setShowClearModal(false);
    const ok = await deleteProgress(row.id);
    if (ok) {
      showToast('Progress cleared', 'success');
    } else {
      showToast('Failed to clear progress', 'error');
    }
  }, [deleteProgress, row.id, showToast]);

  const bookTitle = row.book ? row.book.title : row.document;
  const isUnresolved = row.book === null;

  const metadataList: string[] = [];
  if (row.device) metadataList.push(row.device);
  // `Progress.timestamp` is a `DateTime` scalar — an ISO string on the wire
  // (`app/server/graphql/schema/progress/model.ts`'s `epochSecondsToDate`) —
  // where the REST shape `relativeTime` was built against was a bare
  // epoch-SECONDS number. Converting here, at the display edge, keeps
  // `relativeTime` itself unchanged rather than teaching it a second input
  // shape.
  if (row.timestamp)
    metadataList.push(relativeTime(Math.floor(new Date(row.timestamp).getTime() / 1000)));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator
            value={row.percentage}
            ariaLabel={`Reading progress for ${bookTitle}`}
            size={14}
          />
        </div>
        <div className={cx(styles.book, { [styles.bookUnresolved]: isUnresolved })}>
          {isUnresolved && (
            <AlertOctagonIcon
              width={14}
              height={14}
              className={styles.orphanIcon}
              aria-label="Unlinked progress"
            />
          )}
          <span className={styles.title}>{bookTitle}</span>
        </div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      {showClearModal && (
        <ConfirmModal
          isOpen
          onCancel={handleCancelClear}
          onConfirm={handleConfirmClear}
          icon={AlertOctagonIcon}
          danger
          title="Clear reading progress?"
          confirmText="Clear"
          loading={deleting}
        >
          This will remove your synced reading progress for <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
    </Fragment>
  );
};
