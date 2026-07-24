import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';

import { Page, UploadItem, UploadZone } from '~/component';
import { LibrarySwitcher } from '~/component/library-switcher';
import type { PageActionItem } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import { useScanLibrary, useUploadQueue } from '~/provider/book';
import { useLibraryTarget } from '~/provider/library-target';
import { useToast } from '~/provider/toast';
import { useUserList } from '~/provider/user';
import { path } from '~/router';

import { useStyle } from './style';

export const UploadPage = () => {
  const styles = useStyle();

  const [isAdmin] = useIsAdmin();
  const [targetUsername] = useLibraryTarget();
  const [userList, userListLoading] = useUserList();

  const { items, addFiles, applyFix, applyAllProposals, dismissAllProposals, dismissFix, undo } =
    useUploadQueue();
  const uploadsInProgress = items.some((i) => i.status === 'queued' || i.status === 'uploading');

  const [scanLibrary, , scanning] = useScanLibrary();
  const showToast = useToast();

  // Announce auto-fixed metadata once the batch goes idle, one toast per newly
  // finished set of items. announcedRef tracks item ids we've already surfaced
  // so re-renders (or later batches) don't repeat the toast for the same item.
  const announcedRef = useRef(new Set<string>());
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

  // scanLibrary resolves null for both a real failure and a cancellation, and it
  // only cancels when this page unmounts. Skip the result toast if we've unmounted
  // so navigating away mid-scan doesn't fire a false "Scan failed" on the next page.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const handleScan = useCallback(async () => {
    // The header action has no inline spinner (and on mobile it lives in the "⋯"
    // menu, which closes on tap), so announce the scan start explicitly.
    showToast('Scanning library…', 'info');
    const result = await scanLibrary();
    if (!mountedRef.current) return;
    if (result === null) {
      showToast('Scan failed', 'error');
    } else {
      const changed = result.imported.length + result.removed.length;
      showToast(
        changed === 0
          ? 'Library already up to date'
          : `Scan complete: ${result.imported.length} imported, ${result.removed.length} removed`,
        'success'
      );
    }
  }, [scanLibrary, showToast]);

  const headerActions: PageActionItem[] = [
    {
      label: scanning ? 'Scanning…' : 'Library scan',
      onClick: () => void handleScan(),
      disabled: uploadsInProgress || scanning,
      primary: true,
      align: 'trailing',
    },
  ];

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
    <Page headerActions={headerActions}>
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
            />
          ))}
        </div>
      )}
    </Page>
  );
};
