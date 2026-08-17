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
  const { setBookList, setBookListFetched, setBookListItems } = use(Context);
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
        // former's doc comment for the full mechanism).
        //
        // CORRECTION (2026-08-13 final review, I-3): this comment used to
        // claim "`id` here is always the resolved raw id" — false since
        // `page/book` moved onto GraphQL (step 6): `UploadReplaceModal` is
        // still given `bookId={book.id}`, but `book.id` is now the Relay
        // GLOBAL id, not a raw content hash. `bookList` entries' own `.id`
        // fields are always raw (`useFetchBook`'s doc comment), so `next[key]
        // ?.id === id` below can now NEVER match — this sweep is a dead
        // no-op for every replace, not just the grid-originated-alias case
        // it was written for. That makes the failure mode this comment used
        // to describe UNCONDITIONAL rather than a narrow edge case: a stale
        // pre-replace `bookList` entry under a global-id key is never
        // evicted, so revisiting the book via that original global-id URL
        // (e.g. browser back) could show stale, pre-replace data with no
        // loading state or error — a real, if currently hard-to-reach, bug
        // (`page/book`'s own post-replace `navigate(path.book(updated.id))`
        // is itself broken per C-2, since `updated.id` is raw and `page/book`
        // now requires a global id, so the in-app path to land back on a
        // stale cached entry is already gated by that separate, still-open
        // bug). Left AS IS rather than "fixed" here: repairing it requires
        // first resolving C-2's replace case, which needs a server-supplied
        // global id (see the final-fix report) — out of this fix's scope.
        setBookList((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(next)) {
            if (next[key]?.id === id) delete next[key];
          }
          next[updated.id] = updated;
          return next;
        });
        // Same root cause: `id` is global, `renameProgressKey`'s internal
        // `oldId in userProgress` check is keyed by the RAW documentId
        // (`ProgressProvider`'s REST map, post C-1's fix) — so this now
        // fires on every replace (`updated.id` is raw, so `!==` is
        // vacuously always true) but its own guard never finds a match.
        // Harmless dead weight, not a corruption risk: unlike the sweep
        // above, nothing here silently keeps stale data around.
        if (updated.id !== id) renameProgressKey(id, updated.id);
        setBookListFetched(false);
        setBookListItems(() => []);
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
      renameProgressKey,
    ]
  );

  return useMemo(
    () => ({ analyzeReplacement, commitReplacement, analyzing, committing, commitError }),
    [analyzeReplacement, commitReplacement, analyzing, committing, commitError]
  );
};
