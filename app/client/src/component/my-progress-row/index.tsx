import cx from 'classnames';
import { Fragment, useCallback, useState } from 'react';

import { Button, ConfirmModal, LinkProgressModal } from '~/control';
import { type FragmentType, graphql, useFragment } from '~/gql';
import { AlertOctagonIcon } from '~/icon';
import { useDeleteProgress } from '~/lib/use-progress-mutations';
import { useToast } from '~/provider/toast';
import { relativeTime } from '~/utils';

import { ProgressIndicator } from '../progress-indicator';
import { useStyle } from './style';

/**
 * Colocated: this is the one field selection every progress row (this one
 * AND `component/user-progress-row`, which re-points its own import at this
 * SAME export) renders. Previously declared in `graphql/progress.ts`; moved
 * here to match `DeviceRowFragment`/`UserRowFragment`'s placement — codegen
 * resolves `...ProgressRowFragment` by NAME across its `documents` glob, so
 * `MyProgressListDocument`/`UserProgressListDocument` (each on the component
 * that owns its own conditionally-mounted subtree — see either's own doc
 * comment) keep spreading it with no import needed.
 *
 * `book` is NULLABLE by design — a device syncs progress for documents that
 * are not in this library, and those rows still render with the raw
 * `document` hash and no book link.
 *
 * `id` is `Progress`'s computed global id — the cache key AND
 * `progressDelete`'s argument. It is deliberately NOT resolvable through
 * `node(id:)`; `Progress` is not a `Node`. `document` is the RAW content
 * hash and is what `progressSet` takes.
 */
export const ProgressRowFragment = graphql(`
  fragment ProgressRowFragment on Progress {
    id
    document
    percentage
    currentChapter
    device
    timestamp
    book {
      id
      title
      author
      hasCover
      thumbnailUrl(width: 88)
    }
  }
`);

interface MyProgressRowProps {
  progress: FragmentType<typeof ProgressRowFragment>;
  /**
   * The viewer's own Library global id, off `MyProgressContent`'s own
   * `useCurrentLibraryId()` call — the SAME id that list itself is rooted
   * on, not a second `useCurrentLibraryId()` call per row. Threaded
   * straight into `LinkProgressModal`'s picker (`LinkPickerBooksDocument`'s
   * `node(id: $libraryId)`).
   */
  libraryId: string | undefined;
}

/**
 * Fetch-free: renders entirely off the fragment ref its parent
 * (`MyProgressContent`) already fetched as part of `MyProgressListDocument`
 * — no `useBook` (the old REST per-row book lookup) and no `useMyProgress`
 * (the old REST per-row progress lookup). `useFragment` is called exactly
 * once, unconditionally, in this component's own body — see
 * `MyProgressContent`'s doc comment for why that component returns a masked
 * ref instead of unmasking centrally.
 *
 * `book` is NULLABLE — a device syncs progress for documents not in this
 * library. That row still renders, using the raw `document` hash in place
 * of a title, WITH the same "Link" affordance the REST row offered: opening
 * `LinkProgressModal` so the orphan can be resolved to a book. Fix round 1
 * (review of an earlier task) corrected a version of this component that
 * dropped the button entirely.
 *
 * `LinkProgressModal` is GraphQL-backed (Task 6): the modal takes
 * `libraryId` (this row's own `libraryId` prop, off `MyProgressContent`'s
 * `useCurrentLibraryId()`) and `progressId={row.id}` instead of the old REST
 * modal's `username` — see the modal's own doc comment for why. `useUsername`
 * is gone from this component for the same reason: it existed only to feed
 * the old modal's `username` prop.
 *
 * No `titleSort` preference: `ProgressRowFragment` selects `book { title
 * ... }` only, no sort title — unlike the REST `Book` shape this row used
 * to read via `useBook`.
 */
export const MyProgressRow = ({ progress, libraryId }: MyProgressRowProps) => {
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
          This will remove your synced reading progress for <strong>{bookTitle}</strong>.
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
