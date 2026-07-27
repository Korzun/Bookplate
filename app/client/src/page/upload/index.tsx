import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

import { Page, UploadItem, UploadZone } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import { useIsAdmin } from '~/provider/auth';
import { useLibraryTarget } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
import { useUploadQueue } from '~/provider/upload';
import { useUserList } from '~/provider/user';
import { path } from '~/router';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const [userList, userListLoading] = useUserList();

  const {
    items,
    addFiles,
    applyFix,
    applyAllProposals,
    dismissAllProposals,
    dismissFix,
    undo,
    dismissCompleted,
  } = useUploadQueue();
  const uploadsInProgress = items.some((i) => i.status === 'queued' || i.status === 'uploading');

  const showToast = useToast();

  // Announce auto-fixed metadata once the batch goes idle, one toast per newly
  // finished set of items. announcedRef tracks item ids we've already surfaced
  // so re-renders (or later batches) don't repeat the toast for the same item.
  const announcedRef = useRef(new Set<string>());
  const didInitAnnouncedRef = useRef(false);
  useEffect(() => {
    if (didInitAnnouncedRef.current) return;
    didInitAnnouncedRef.current = true;
    // Items already present at mount (restored from storage) were not fixed in
    // this session — mark them announced so they never trigger the toast.
    items.forEach((i) => announcedRef.current.add(i.id));
  }, [items]);
  useEffect(() => {
    if (uploadsInProgress) return; // wait until the batch is idle
    const doneItems = items.filter((i) => i.status === 'done');
    const fixedNow = doneItems.filter(
      (i) => (i.appliedFixes?.length ?? 0) > 0 && !announcedRef.current.has(i.id)
    );
    if (fixedNow.length > 0) {
      showToast(
        `Auto-fixed metadata on ${fixedNow.length} book${fixedNow.length === 1 ? '' : 's'}.`,
        'info'
      );
    }
    // Mark every currently-done item as announced — including ones with zero
    // auto-fixes — so a later *manual* Apply (which moves a fix into
    // appliedFixes) can't retroactively look "newly fixed" and re-trigger
    // this toast.
    doneItems.forEach((i) => announcedRef.current.add(i.id));
  }, [items, uploadsInProgress, showToast]);

  if (isAdmin && !targetUsername) {
    const noUsers = !userListLoading && userList.length === 0;
    return (
      <Page>
        <LibrarySwitcher />
        <div className={styles.emptyState}>
          {noUsers ? (
            <>
              <div className={styles.emptyStateTitle}>No users registered</div>
              <div className={styles.emptyStateSubtitle}>
                Go to the{' '}
                <Link className={styles.link} to={path.userList()}>
                  Users
                </Link>{' '}
                page to register the first user
              </div>
            </>
          ) : (
            <>
              <div className={styles.emptyStateTitle}>Select a library</div>
              <div className={styles.emptyStateSubtitle}>Choose a user above to upload books</div>
            </>
          )}
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <UploadZone addFiles={addFiles} />
      {items.length > 0 && (
        <div className={styles.queue}>
          {items.map((item) => (
            <UploadItem
              key={item.id}
              item={item}
              onApplyFix={async (fix) => {
                const ok = await applyFix(item.id, fix);
                if (!ok) showToast("Couldn't apply fix", 'error');
              }}
              onApplyAll={async () => {
                const ok = await applyAllProposals(item.id);
                if (!ok) showToast("Couldn't apply fixes", 'error');
              }}
              onDismissAll={() => dismissAllProposals(item.id)}
              onUndo={async () => {
                const ok = await undo(item.id);
                if (!ok) showToast("Couldn't undo", 'error');
              }}
              onDismissFix={(fix) => dismissFix(item.id, fix)}
              onDismissCompleted={() => dismissCompleted(item.id)}
            />
          ))}
        </div>
      )}
    </Page>
  );
};
