import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal, LinkProgressModal } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import { AlertOctagonIcon } from '~/icon';
import { useDeleteProgress } from '~/lib/use-progress-mutations';
import { useToast } from '~/provider/toast';
import { relativeTime } from '~/utils';

import { ProgressRowFragment } from '../my-progress-row';
import { ProgressIndicator } from '../progress-indicator';
import { useStyle } from './style';

interface UserProgressRowProps {
  progress: FragmentType<typeof ProgressRowFragment>;
  /** The TARGET user's username — never the viewer's own. */
  username: string;
  /**
   * The TARGET user's Library global id, off `UserRowContent`'s own
   * `usePaginatedConnection` read of `UserProgressListDocument` —
   * `user.library.id` (already part of that document, not a second fetch).
   * Threaded into `LinkProgressModal`'s picker (`LinkPickerBooksDocument`'s
   * `node(id: $libraryId)`) so it roots on the TARGET user's library, not
   * `useCurrentLibraryId()`'s admin `library-target` selection — a single
   * global choice unrelated to any one row on the Users page.
   */
  libraryId: string | undefined;
}

/**
 * The admin's view of ANOTHER user's progress row. Mirrors `MyProgressRow`
 * (`component/my-progress-row`) closely — read that component's own doc
 * comment first, this is its closest sibling: fetch-free, renders entirely
 * off the fragment ref its parent (`UserRowContent`) already fetched as
 * part of `UserProgressListDocument` — no `useBook` (the old REST per-row
 * book lookup) and no `useUserProgress` (the old REST per-row progress
 * lookup). `useFragment` is called exactly once, unconditionally, in this
 * component's own body — see `UserRowContent`'s doc comment for why that
 * component returns a masked ref instead of unmasking centrally.
 *
 * `book` is NULLABLE — a device syncs progress for documents not in this
 * library. That row still renders, using the raw `document` hash in place
 * of a title, WITH the same "Link" affordance the REST row offered: opening
 * `LinkProgressModal` so the orphan can be resolved to a book.
 *
 * `LinkProgressModal` is GraphQL-backed (Task 6): it takes `libraryId`
 * (this row's own `libraryId` prop, the TARGET user's library, never the
 * viewer's own) and `progressId={row.id}` instead of the old REST modal's
 * `username`. `username` itself stays a required prop here regardless — it
 * still feeds the Clear confirm modal's copy below, unrelated to the link
 * picker.
 *
 * The REST version of this row additionally gated the Link button on
 * `useIsAdmin()`. That client-side check has no analogue here: this
 * component only ever renders a row at all once `UserRowContent`'s
 * `Query.user(id:)` query has already succeeded, and that query is
 * admin-only SERVER-SIDE (schema-verified, `graphql/progress.ts`'s doc
 * comment previously carried on `UserProgressListDocument`, now on that
 * document itself in `component/user-row-content`) — refusing even a
 * non-admin's OWN id. A non-admin can never reach a state where this row
 * has data to render in the first place, so there is no reachable code path
 * left for a redundant client-side gate to guard.
 *
 * No `titleSort` preference: `ProgressRowFragment` selects `book { title
 * ... }` only, no sort title — unlike the REST `Book` shape this row used
 * to read via `useBook`.
 */
export const UserProgressRow = ({ progress, username, libraryId }: UserProgressRowProps) => {
  const styles = useStyle();
  const row = useFragment(ProgressRowFragment, progress);
  const { deleteProgress, deleting } = useDeleteProgress();
  const showToast = useToast();

  const [showClearModal, setShowClearModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

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
        {isUnresolved && (
          <Button type="link" onClick={() => setShowLinkModal(true)}>
            Link
          </Button>
        )}
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
          This will remove <strong>{username}</strong>&apos;s synced reading progress for{' '}
          <strong>{bookTitle}</strong>.
        </ConfirmModal>
      )}
      {showLinkModal && libraryId !== undefined && (
        <LinkProgressModal
          isOpen
          documentId={row.document}
          libraryId={libraryId}
          progressId={row.id}
          onClose={() => setShowLinkModal(false)}
        />
      )}
    </Fragment>
  );
};
