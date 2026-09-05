import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';

import { UploadItem, UploadZone } from '~/component';
import { useToast } from '~/provider/toast';
import type { UploadItem as UploadItemType } from '~/provider/upload';
import { useUploadQueue } from '~/provider/upload';

import { buildUploadActions } from './actions';
import { type AddOutletContext } from './index';
import { useStyle } from './style';

const isDismissible = (i: UploadItemType) =>
  i.status === 'error' || (i.status === 'done' && (i.proposals?.length ?? 0) === 0);

export const AddUploadView = () => {
  const styles = useStyle();
  const { setHeaderActions } = useOutletContext<AddOutletContext>();

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
  const hasDismissible = items.some(isDismissible);
  const hasActionable = items.some((i) => (i.proposals ?? []).some((p) => p.to !== null));
  const hasProposals = items.some((i) => (i.proposals?.length ?? 0) > 0);

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

  // Guards against a rapid re-entrant click firing a second, parallel PATCH
  // wave over the same items while the first Accept All is still applying
  // (mirrors the per-item `busy` guard in component/upload-item/index.tsx).
  const acceptAllInFlightRef = useRef(false);
  // Drives `actionsDisabled` on every card so the per-upload accept/reject
  // controls lock while a queue-wide Accept all is applying. The ref above is
  // the re-entrancy guard (synchronous); this state is purely for rendering.
  const [acceptingAll, setAcceptingAll] = useState(false);
  const handleAcceptAll = useCallback(async () => {
    if (acceptAllInFlightRef.current) return;
    acceptAllInFlightRef.current = true;
    setAcceptingAll(true);
    try {
      let failed = false;
      for (const item of items) {
        if ((item.proposals ?? []).some((p) => p.to !== null)) {
          const ok = await applyAllProposals(item.id);
          if (!ok) failed = true;
        }
      }
      if (failed) showToast("Couldn't apply some fixes", 'error');
    } finally {
      acceptAllInFlightRef.current = false;
      setAcceptingAll(false);
    }
  }, [items, applyAllProposals, showToast]);

  const handleRejectAll = useCallback(() => {
    for (const item of items) {
      if ((item.proposals?.length ?? 0) > 0) void dismissAllProposals(item.id);
    }
  }, [items, dismissAllProposals]);

  const handleDismissAll = useCallback(() => {
    for (const item of items) {
      if (isDismissible(item)) dismissCompleted(item.id);
    }
  }, [items, dismissCompleted]);

  // MEMOIZED, and that is load-bearing: `buildUploadActions` returns a fresh
  // array every call, so an effect keyed on the array itself would publish new
  // actions on every render and loop forever.
  const headerActions = useMemo(
    () =>
      buildUploadActions(
        { hasDismissible, hasActionable, hasProposals },
        {
          onDismissAll: handleDismissAll,
          onAcceptAll: () => void handleAcceptAll(),
          onRejectAll: handleRejectAll,
        }
      ),
    [
      hasDismissible,
      hasActionable,
      hasProposals,
      handleDismissAll,
      handleAcceptAll,
      handleRejectAll,
    ]
  );
  useEffect(() => {
    setHeaderActions(headerActions);
    return () => setHeaderActions(undefined);
  }, [headerActions, setHeaderActions]);

  return (
    <>
      <UploadZone addFiles={addFiles} />
      {items.length > 0 && (
        <div className={styles.queue}>
          {items.map((item) => (
            <UploadItem
              key={item.id}
              item={item}
              actionsDisabled={acceptingAll}
              onApplyFix={async (fix) => {
                const ok = await applyFix(item.id, fix);
                if (!ok) showToast("Couldn't apply fix", 'error');
              }}
              onApplyAll={async () => {
                const ok = await applyAllProposals(item.id);
                if (!ok) showToast("Couldn't apply fixes", 'error');
              }}
              onDismissAll={() => void dismissAllProposals(item.id)}
              onUndo={async () => {
                const ok = await undo(item.id);
                if (!ok) showToast("Couldn't undo", 'error');
              }}
              onDismissFix={(fix) => void dismissFix(item.id, fix)}
              onDismissCompleted={() => dismissCompleted(item.id)}
            />
          ))}
        </div>
      )}
    </>
  );
};
