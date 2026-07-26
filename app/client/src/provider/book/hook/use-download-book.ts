import { useCallback, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';

export type UseDownloadBook = [(id: string) => Promise<boolean>, boolean];

const FILENAME_STAR = /filename\*=UTF-8''([^;]+)/i;

function filenameFromDisposition(header: string | null): string {
  if (header) {
    const match = FILENAME_STAR.exec(header);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        /* fall through to default */
      }
    }
  }
  return 'book.epub';
}

export const useDownloadBook = (): UseDownloadBook => {
  const withTargetUser = useWithTargetUser();
  const [loading, setLoading] = useState(false);

  const downloadBook = useCallback(
    async (id: string): Promise<boolean> => {
      if (loading) return false;

      try {
        setLoading(true);
        const res = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(id)}/download`));
        if (!res.ok) return false;

        const filename = filenameFromDisposition(res.headers.get('Content-Disposition'));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      } finally {
        setLoading(false);
      }
    },
    [withTargetUser, loading]
  );

  return useMemo<UseDownloadBook>(() => [downloadBook, loading], [downloadBook, loading]);
};
