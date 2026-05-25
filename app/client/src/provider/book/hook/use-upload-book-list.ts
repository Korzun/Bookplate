import { useCallback, useContext, useMemo, useState } from 'react';

import { Context } from '../context';
import type { UploadResult } from '../type';

import { useFetchBookList } from './use-fetch-book-list';

export type UseUploadBookList = [
  (files: FileList) => Promise<void>,
  UploadResult | undefined,
  boolean,
  boolean,
  string | undefined,
];
export const useUploadBookList = (): UseUploadBookList => {
  const { clearCompleteBookIds } = useContext(Context);
  const fetchBookList = useFetchBookList();
  const [uploadResult, setUploadResult] = useState<UploadResult | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const uploadBooks = useCallback(
    async (files: FileList): Promise<void> => {
      // Prevent multiple parallel requests
      if (loading) {
        return;
      }

      setLoading(true);
      setError(false);
      setErrorMessage(undefined);
      setUploadResult(undefined);

      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append('files', file);
        }

        const response = await fetch('/api/books/upload', { method: 'POST', body: formData });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? 'Upload failed');
        }
        const uploadResult = await (response.json() as Promise<UploadResult>);
        setUploadResult(uploadResult);
        clearCompleteBookIds();
        fetchBookList();
      } catch (error) {
        setError(true);
        if (error instanceof Error) {
          setErrorMessage(error.message);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchBookList, clearCompleteBookIds, loading]
  );

  return useMemo(
    () => [uploadBooks, uploadResult, loading, error, errorMessage],
    [uploadBooks, uploadResult, loading, error, errorMessage]
  );
};
