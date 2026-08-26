import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LibraryScanDocument } from '~/graphql/scan';
import { useCurrentLibraryId } from '~/provider/library-target';

import { useScanProgress } from './use-scan-progress';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

export type ScanLibrary = () => Promise<void>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined] // Initial state
  | [ScanLibrary, undefined, true, false, undefined] // Scan is under way
  | [ScanLibrary, ScanResult, false, false, undefined] // Scan completed successfully
  | [ScanLibrary, undefined, false, true, undefined] // Unspecified error while scanning
  | [ScanLibrary, undefined, false, true, string]; // Specified error while scanning

/**
 * Starts a library scan and reports its live progress.
 *
 * **Placement (Task 8).** This lived in `provider/book/hook/` until that
 * barrel was dissolved. It is not a bare `useMutation` wrapper that inlines
 * cleanly into its caller: it composes `libraryScan` with `useScanProgress`'s
 * query+subscription pair AND owns a completion effect that evicts
 * `Library.entries`. It has exactly ONE consumer — `./index.tsx`, rendered by
 * `component/scan-library-setting` on `page/user` — so it now sits in that
 * component's own directory. That is the colocation the project asks for (no
 * cross-cutting barrel, code next to its only call site) while keeping the
 * hook-level tests that pin the attach path, the completion eviction and the
 * error folding, which a component-level rewrite would have had to
 * re-derive.
 *
 * Replaces a 2-second polling loop against the REST scan-status endpoint. The
 * mount-time "attach to a running scan" effect is gone too — it is now
 * structural rather than something this hook arranges: `useScanProgress` always
 * reads current `scanStatus` alongside the stream, so a page reloaded mid-scan
 * renders the running state on first paint.
 *
 * `ScanAlreadyRunningError` is the attach path, not a failure — it is the
 * direct equivalent of the REST route's HTTP 409, and it carries the live
 * status, so it is treated as success exactly as the old code treated 409.
 *
 * `scanLibrary` resolves `void`, not the old `ScanResult | null`: completion
 * now arrives asynchronously over the subscription, so the mutation has no
 * result to hand back. The tuple's second slot still carries the ScanResult,
 * driven by the terminal status.
 */
export const useScanLibrary = (): UseScanLibrary => {
  const client = useApolloClient();
  const { libraryId } = useCurrentLibraryId();
  const { status, userId, error: progressError } = useScanProgress(libraryId);

  const [startScan] = useMutation(LibraryScanDocument);
  const [startError, setStartError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);

  const running = starting || status?.state === 'RUNNING';

  const scanLibrary: ScanLibrary = useCallback(async () => {
    // Guard concurrent presses, exactly as the polling version did: a
    // re-entrant click while a scan is already under way stays silent.
    if (running) return;
    // No library owner to scan for (e.g. the config-based admin, for whom
    // `useCurrentLibraryId` returns undefined — the admin library-target
    // reshape is a later plan). Unlike the running-guard above, this must
    // surface feedback: a silent return here would leave the "Scanning
    // library…" toast and the button's loading state hanging forever, since
    // no state changes and the completion effect never re-runs.
    if (!userId) {
      setStartError('No library to scan');
      return;
    }

    setStarting(true);
    setStartError(undefined);
    try {
      const { data } = await startScan({ variables: { userId } });
      const result = data?.libraryScan;
      // Three-way branch: null (owner gone) / typed error member / payload.
      // ScanAlreadyRunningError is NOT a failure — it is the attach path, the
      // equivalent of the REST route's 409, and it carries the live status.
      // Both it and LibraryScanPayload leave progress to `useScanProgress`,
      // so neither needs anything read off the payload here.
      if (!result) setStartError('Failed to start scan');
    } catch (err) {
      setStartError(err instanceof Error ? err.message : undefined);
    } finally {
      setStarting(false);
    }
  }, [running, userId, startScan]);

  // Fire the completion side effects once per finished job, not on every
  // re-render while the terminal status stays in the cache. A scan can add
  // or remove many books at once, so — like an upload's `onUploaded` and a
  // fix's ACCEPT/UNDO — the grid's `Library.entries` connection is evicted
  // outright rather than patched: there is no scan-result payload shaped to
  // reconcile individual edges from, and the new set's ordering is the
  // server's to decide.
  const completedJobRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (status?.state !== 'COMPLETED' || status.id === completedJobRef.current) return;
    completedJobRef.current = status.id;
    if (libraryId !== undefined) {
      client.cache.evict({
        id: client.cache.identify({ __typename: 'Library', id: libraryId }),
        fieldName: 'entries',
      });
      client.cache.gc();
    }
  }, [status?.state, status?.id, client, libraryId]);

  const scanResult = useMemo<ScanResult | undefined>(() => {
    if (status?.state !== 'COMPLETED') return undefined;
    return {
      // `ScanResult.imported` is [Book!]! in GraphQL; `importedFilenames` is the
      // string list this tuple has always carried (REST parity).
      imported: status.result?.importedFilenames ?? [],
      removed: status.result?.removed ?? [],
    };
  }, [status?.state, status?.result]);

  // `progressError` covers a refused SSE stream or a failed bootstrap query —
  // without it, either failure mode is indistinguishable from "no scan is
  // running" and the progress UI would freeze silently instead of toasting.
  const failed =
    status?.state === 'FAILED' || startError !== undefined || progressError !== undefined;
  const errorMessage = status?.error ?? startError ?? progressError?.message ?? undefined;

  return useMemo(
    () =>
      [
        scanLibrary,
        failed ? undefined : scanResult,
        running,
        failed,
        failed ? errorMessage : undefined,
      ] as UseScanLibrary,
    [scanLibrary, scanResult, running, failed, errorMessage]
  );
};
