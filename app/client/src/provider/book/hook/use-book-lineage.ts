import { useEffect, useState } from 'react';

export type LineageEntry = {
  oldId: string;
  newId: string;
  timestamp: number;
};

export type BookLineage = {
  currentId: string;
  entries: LineageEntry[];
};

export type UseBookLineage =
  | [undefined, true, false]
  | [undefined, false, true]
  | [BookLineage, false, false];

type FetchResult = { bookId: string; data: BookLineage } | { bookId: string; error: true };

export const useBookLineage = (bookId: string): UseBookLineage => {
  const [result, setResult] = useState<FetchResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/books/${encodeURIComponent(bookId)}/lineage`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch lineage');
        return response.json() as Promise<BookLineage>;
      })
      .then((data) => {
        if (!cancelled) setResult({ bookId, data });
      })
      .catch(() => {
        if (!cancelled) setResult({ bookId, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (result === null || result.bookId !== bookId) return [undefined, true, false];
  if ('error' in result) return [undefined, false, true];
  return [result.data, false, false];
};
