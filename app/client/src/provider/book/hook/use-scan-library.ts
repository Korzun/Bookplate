import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

export type ScanLibrary = () => Promise<void>;
export type UseScanLibrary =
  | [ScanLibrary, undefined, false, false, undefined] // Initial state
  | [ScanLibrary, undefined, true, false, undefined] // Scan is under way
  | [ScanLibrary, ScanResult, false, false, undefined] // Scan completed successfully
  | [ScanLibrary, undefined, false, true, undefined] // There was an unspecified error while scanning
  | [ScanLibrary, undefined, false, true, string]; // There was a specified error while scanning
export const useScanLibrary = (): UseScanLibrary => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [scanResult, setScanResult] = useState<ScanResult | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const scanLibrary: ScanLibrary = useCallback(async () => {
    // Prevent multiple parallel requests
    if (loading) {
      return;
    }

    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    setScanResult(undefined);

    try {
      const response = await fetch('/api/books/scan', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Scan failed');
      }
      const scanResult = await (response.json() as Promise<ScanResult>);
      setScanResult(scanResult);
      clearCompleteBookIds();
      fetchBookList();
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchBookList, clearCompleteBookIds, loading]);

  return useMemo(
    () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
    [scanLibrary, scanResult, loading, error, errorMessage]
  );
};
