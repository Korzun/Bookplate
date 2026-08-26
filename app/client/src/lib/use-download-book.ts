import { useCallback, useMemo, useState } from 'react';

import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from './api-fetch';

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

/**
 * Downloads a book's EPUB bytes over the sanctioned REST seam.
 *
 * Lives in `~/lib`, not with its caller (`page/book`), for the same reason
 * `lib/staged-upload.ts` and `lib/use-authorized-src.ts` do: it is one of the
 * eight entries in `lib/rest-seams.test.ts`' allow-list, and that list is
 * read as the register of where this client is still allowed to speak REST.
 * A binary download has no GraphQL transport, so this seam is permanent
 * rather than un-migrated — it moved here when `provider/book/` dissolved
 * (Task 8) precisely so it stops looking like a leftover of that directory.
 */
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
