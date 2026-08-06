import { useCallback, use, useMemo, useState } from 'react';

import type { Severity, ValidationMessage, ValidationThreshold } from '~/lib/severity';
import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context as ProgressContext } from '../../progress/context';
import { Context } from '../context';
import { Book, MetadataFix } from '../type';

export interface ReplaceAnalysis {
  valid: boolean;
  messages: ValidationMessage[];
  counts: Record<Severity, number>;
  threshold: ValidationThreshold;
  autoFixes: MetadataFix[];
  proposals: MetadataFix[];
}

export interface UseReplaceBook {
  analyzeReplacement: (id: string, file: File) => Promise<ReplaceAnalysis | undefined>;
  commitReplacement: (
    id: string,
    file: File,
    acceptedFixKeys: string[]
  ) => Promise<Book | undefined>;
  analyzing: boolean;
  committing: boolean;
  commitError: string | undefined;
}

export const useReplaceBook = (): UseReplaceBook => {
  const { setBookList, setBookListFetched, setBookListItems, setNextCursor } = use(Context);
  const { renameProgressKey } = use(ProgressContext);
  const withTargetUser = useWithTargetUser();
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | undefined>(undefined);

  const analyzeReplacement = useCallback(
    async (id: string, file: File): Promise<ReplaceAnalysis | undefined> => {
      if (analyzing) return undefined;
      try {
        setAnalyzing(true);
        // Picking a new file to analyze supersedes any previous commit
        // attempt — clear its error so a stale message doesn't linger.
        setCommitError(undefined);
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(id)}/replace/analyze`),
          { method: 'POST', body: fd }
        );
        if (!res.ok) return undefined;
        return (await res.json()) as ReplaceAnalysis;
      } catch {
        return undefined;
      } finally {
        setAnalyzing(false);
      }
    },
    [withTargetUser, analyzing]
  );

  const commitReplacement = useCallback(
    async (id: string, file: File, acceptedFixKeys: string[]): Promise<Book | undefined> => {
      if (committing) return undefined;
      try {
        setCommitting(true);
        setCommitError(undefined);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('acceptedFixKeys', JSON.stringify(acceptedFixKeys));
        const res = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(id)}/replace`), {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setCommitError(body.error);
          return undefined;
        }
        const updated = (await res.json()) as Book;
        // Delete every `bookList` entry describing the PRE-replace book
        // (`.id === id`), not just `next[id]` itself — same fix as
        // `use-regen-chapters.ts`/`use-patch-book-metadata.ts` (see the
        // former's doc comment for the full mechanism). `id` here is
        // always the resolved raw id (`UploadReplaceModal` is given
        // `bookId={book.id}` by `page/book`), but `bookList` is keyed by
        // whatever id `useFetchBook` was REQUESTED under — a Relay global
        // id for a grid-originated visit. `next[id]` alone leaves that
        // alias holding the pre-replace book forever, masked by the
        // immediate post-replace `navigate(path.book(newId))` (which
        // populates the NEW id's own entry correctly) — but browsing back
        // to the ORIGINAL url shows the stale, pre-replace book with no
        // loading state or error.
        setBookList((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.id === id) delete next[key];
          }
          next[updated.id] = updated;
          return next;
        });
        if (updated.id !== id) renameProgressKey(id, updated.id);
        setBookListFetched(false);
        setBookListItems(() => []);
        setNextCursor(null);
        setCommitError(undefined);
        return updated;
      } catch {
        return undefined;
      } finally {
        setCommitting(false);
      }
    },
    [
      withTargetUser,
      committing,
      setBookList,
      setBookListFetched,
      setBookListItems,
      setNextCursor,
      renameProgressKey,
    ]
  );

  return useMemo(
    () => ({ analyzeReplacement, commitReplacement, analyzing, committing, commitError }),
    [analyzeReplacement, commitReplacement, analyzing, committing, commitError]
  );
};
