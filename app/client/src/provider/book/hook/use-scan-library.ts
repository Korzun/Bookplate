import { useCallback, useContext, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type ScanResult = {
  imported: string[];
  removed: string[];
};

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

  const scanLibrary: ScanLibrary = useCallback(async () => {
    // Prevent multiple parallel requests
    if (loading) return null;

    setLoading(true);
    setError(false);
    setErrorMessage(undefined);
    setScanResult(undefined);

    try {
      const response = await apiFetch(withTargetUser('/api/books/scan'), { method: 'POST' });
      if (!response.ok) {
        throw new Error('Scan failed');
      }
      const result = await (response.json() as Promise<ScanResult>);
      setScanResult(result);
      clearCompleteBookIds();
      fetchBookList();
      return result;
    } catch (err) {
      setError(true);
      if (err instanceof Error) {
        setErrorMessage(err.message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [withTargetUser, fetchBookList, clearCompleteBookIds, loading]);

  return useMemo(
    () => [scanLibrary, scanResult, loading, error, errorMessage] as UseScanLibrary,
    [scanLibrary, scanResult, loading, error, errorMessage]
  );
};
