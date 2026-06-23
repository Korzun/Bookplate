import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

type ScanStatus =
  | { status: 'idle' }
  | {
      jobId: string;
      status: 'running' | 'completed' | 'failed';
      startedAt: number;
      result?: ScanResult;
      error?: string;
    };

const POLL_INTERVAL_MS = 2000;

export type ScanLibrary = () => Promise<ScanResult | null>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined] // Initial state
  | [ScanLibrary, undefined, true, false, undefined] // Scan is under way
  | [ScanLibrary, ScanResult, false, false, undefined] // Scan completed successfully
  | [ScanLibrary, undefined, false, true, undefined] // There was an unspecified error while scanning
  | [ScanLibrary, undefined, false, true, string]; // There was a specified error while scanning

export const useScanLibrary = (): UseScanLibrary => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const withTargetUser = useWithTargetUser();
  const [scanResult, setScanResult] = useState<ScanResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const cancelledRef = useRef(false);
  const pollPromiseRef = useRef<Promise<ScanResult | null> | null>(null);

  const applyCompletion = useCallback(
    (result: ScanResult) => {
      setScanResult(result);
      clearCompleteBookIds();
      fetchBookList();
    },
    [clearCompleteBookIds, fetchBookList]
  );

  // Polls the status endpoint until the job reaches a terminal state.
  // Resolves with the result on completion, or null on failure/cancellation.
  // Concurrent callers share a single in-flight poll via pollPromiseRef.
  const pollUntilDone = useCallback((): Promise<ScanResult | null> => {
    if (pollPromiseRef.current !== null) return pollPromiseRef.current;
    const promise = (async (): Promise<ScanResult | null> => {
      while (!cancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelledRef.current) return null;
        let response: Response;
        try {
          response = await apiFetch(withTargetUser('/api/books/scan/status'));
        } catch {
          if (!cancelledRef.current) setError(true);
          return null;
        }
        if (!response.ok) {
          if (!cancelledRef.current) setError(true);
          return null;
        }
        const job = (await response.json()) as ScanStatus;
        if (job.status === 'completed') {
          const result = job.result ?? { imported: [], removed: [] };
          if (!cancelledRef.current) applyCompletion(result);
          return result;
        }
        if (job.status === 'failed') {
          if (!cancelledRef.current) {
            setError(true);
            setErrorMessage('error' in job ? job.error : undefined);
          }
          return null;
        }
        if (job.status === 'idle') {
          // The job is gone (e.g. the server restarted mid-scan). Treat as
          // terminal so the loop can't poll forever and leave loading stuck.
          return null;
        }
        // 'running' → keep polling
      }
      return null;
    })();
    pollPromiseRef.current = promise;
    void promise.finally(() => {
      pollPromiseRef.current = null;
    });
    return promise;
  }, [withTargetUser, applyCompletion]);

  const scanLibrary: ScanLibrary = useCallback(async () => {
    if (loading) return null;

    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    setScanResult(undefined);

    try {
      const response = await apiFetch(withTargetUser('/api/books/scan'), { method: 'POST' });
      // 202 = started, 409 = already running; both mean "attach and poll".
      if (response.status !== 202 && response.status !== 409) {
        setError(true);
        return null;
      }
      return await pollUntilDone();
    } catch (err) {
      setError(true);
      if (err instanceof Error) setErrorMessage(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [withTargetUser, pollUntilDone, loading]);

  // On mount, attach to an already-running scan (e.g. a page reload mid-scan)
  // so the button shows its loading state and we surface the eventual result.
  useEffect(() => {
    cancelledRef.current = false;
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch(withTargetUser('/api/books/scan/status'));
        if (!active || !response.ok) return;
        const job = (await response.json()) as ScanStatus;
        if (active && job.status === 'running') {
          setLoading(true);
          await pollUntilDone();
          if (active) setLoading(false);
        }
      } catch {
        /* ignore status errors on mount */
      }
    })();
    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [withTargetUser, pollUntilDone]);

  return useMemo(
    () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
    [scanLibrary, scanResult, loading, error, errorMessage]
  );
};
