import { useCallback, use, useMemo, useState } from 'react';

import type { ValidationReport } from '~/lib/severity';
import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch } from '../../../lib/api-fetch';
import { Context as ProgressContext } from '../../progress/context';
import { Context } from '../context';
import { Book } from '../type';

export interface UseReplaceBook {
  validateReplacement: (id: string, file: File) => Promise<ValidationReport | undefined>;
  commitReplacement: (id: string, file: File) => Promise<Book | undefined>;
  validating: boolean;
  committing: boolean;
}

export const useReplaceBook = (): UseReplaceBook => {
  const { setBookList, setBookListFetched, setBookListItems, setNextCursor } = use(Context);
  const { renameProgressKey } = use(ProgressContext);
  const withTargetUser = useWithTargetUser();
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);

  const validateReplacement = useCallback(
    async (id: string, file: File): Promise<ValidationReport | undefined> => {
      if (validating) return undefined;
      try {
        setValidating(true);
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiFetch(
          withTargetUser(`/api/books/${encodeURIComponent(id)}/replace/validate`),
          { method: 'POST', body: fd }
        );
        if (!res.ok) return undefined;
        return (await res.json()) as ValidationReport;
      } catch {
        return undefined;
      } finally {
        setValidating(false);
      }
    },
    [withTargetUser, validating]
  );

  const commitReplacement = useCallback(
    async (id: string, file: File): Promise<Book | undefined> => {
      if (committing) return undefined;
      try {
        setCommitting(true);
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiFetch(withTargetUser(`/api/books/${encodeURIComponent(id)}/replace`), {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) return undefined;
        const updated = (await res.json()) as Book;
        setBookList((prev) => {
          const next = { ...prev, [updated.id]: updated };
          if (updated.id !== id) delete next[id];
          return next;
        });
        if (updated.id !== id) renameProgressKey(id, updated.id);
        setBookListFetched(false);
        setBookListItems(() => []);
        setNextCursor(null);
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
    () => ({ validateReplacement, commitReplacement, validating, committing }),
    [validateReplacement, commitReplacement, validating, committing]
  );
};
