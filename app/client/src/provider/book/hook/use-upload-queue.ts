import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ValidationFailure } from '~/lib/severity';
import { useWithTargetUser } from '~/provider/library-target';

import { apiFetch, ensureFreshToken } from '../../../lib/api-fetch';
import { Context } from '../context';
import type { MetadataFix, UploadFileResult } from '../type';
import { useFetchBookList } from './use-fetch-book-list';
import type { BookMetadataPatch } from './use-patch-book-metadata';
import { usePatchBookMetadata } from './use-patch-book-metadata';

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error';

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  bytesUploaded: number;
  errorMessage?: string;
  validation?: ValidationFailure;
  bookId?: string;
  appliedFixes?: MetadataFix[];
  proposals?: MetadataFix[];
};

export type UseUploadQueue = {
  items: UploadItem[];
  addFiles: (files: FileList) => void;
  applyFix: (itemId: string, fix: MetadataFix) => Promise<boolean>;
  applyAllProposals: (itemId: string) => Promise<boolean>;
  dismissFix: (itemId: string, fix: MetadataFix) => void;
};

/** Fixes have no server id — the queue identifies them by field:kind. */
export const fixKey = (fix: MetadataFix): string => `${fix.field}:${fix.kind}`;

/** The PATCH hook accepts scalar strings and `subjects: string[]`; the fix's
 * `changes` map already matches that shape field-by-field. */
function changesToPatch(changes: Record<string, string | string[]>): Partial<BookMetadataPatch> {
  return { ...changes } as Partial<BookMetadataPatch>;
}

export const useUploadQueue = (): UseUploadQueue => {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const fetchBookList = useFetchBookList();
  const { clearCompleteBookIds } = useContext(Context);
  const withTargetUser = useWithTargetUser();
  const [patchBookMetadata] = usePatchBookMetadata();

  // IDs of items whose XHR has been created — prevents double-starting across renders
  const startedRef = useRef(new Set<string>());
  // Active XHRs keyed by item ID — used for cleanup on unmount
  const xhrMapRef = useRef(new Map<string, XMLHttpRequest>());
  // Stable counter for generating unique IDs within this hook instance
  const nextIdRef = useRef(0);
  // Stable refs to avoid stale closure captures inside xhr.onload
  const fetchBookListRef = useRef(fetchBookList);
  const clearCompleteBookIdsRef = useRef(clearCompleteBookIds);
  const withTargetUserRef = useRef(withTargetUser);
  // Latest items, read by the fix actions so callbacks stay stable
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    fetchBookListRef.current = fetchBookList;
    clearCompleteBookIdsRef.current = clearCompleteBookIds;
    withTargetUserRef.current = withTargetUser;
    itemsRef.current = items;
  });

  // Fetch server config on mount
  useEffect(() => {
    void apiFetch('/api/config')
      .then((r) => r.json() as Promise<{ maxConcurrentUploads: number }>)
      .then((cfg) => setMaxConcurrent(cfg.maxConcurrentUploads))
      .catch(() => {
        // keep default of 3 on failure
      });
  }, []);

  // Abort in-flight XHRs when the page unmounts
  useEffect(() => {
    const xhrMap = xhrMapRef.current;
    return () => {
      for (const xhr of xhrMap.values()) {
        xhr.abort();
      }
    };
  }, []);

  // Rolling concurrency: start uploads whenever a slot is free
  useEffect(() => {
    const inFlight = startedRef.current.size;
    const slots = maxConcurrent - inFlight;
    if (slots <= 0) return;

    const toStart = items
      .filter((i) => i.status === 'queued' && !startedRef.current.has(i.id))
      .slice(0, slots);

    for (const item of toStart) {
      startedRef.current.add(item.id);

      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' as const } : i))
      );

      const xhr = new XMLHttpRequest();
      xhrMapRef.current.set(item.id, xhr);

      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, bytesUploaded: e.loaded } : i))
          );
        }
      };

      xhr.onload = () => {
        startedRef.current.delete(item.id);
        xhrMapRef.current.delete(item.id);

        if (xhr.status >= 200 && xhr.status < 300) {
          let result: UploadFileResult | undefined;
          try {
            const data = JSON.parse(xhr.responseText) as { results?: UploadFileResult[] };
            result = data.results?.[0];
          } catch {
            // no structured result
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: 'done' as const,
                    bytesUploaded: item.file.size,
                    bookId: result?.bookId,
                    appliedFixes: result?.applied ?? [],
                    proposals: result?.proposals ?? [],
                  }
                : i
            )
          );
          clearCompleteBookIdsRef.current();
          void fetchBookListRef.current();
        } else {
          let errorMessage: string | undefined;
          let validation: ValidationFailure | undefined;
          try {
            const data = JSON.parse(xhr.responseText) as {
              error?: string;
              validation?: ValidationFailure;
            };
            errorMessage = data.error;
            validation = data.validation;
          } catch {
            // no structured error
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: 'error' as const, errorMessage, validation } : i
            )
          );
        }
      };

      xhr.onerror = () => {
        startedRef.current.delete(item.id);
        xhrMapRef.current.delete(item.id);
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: 'error' as const } : i))
        );
      };

      void (async () => {
        const token = await ensureFreshToken();
        // The XHR may have been aborted (unmount) while we awaited the refresh.
        if (xhrMapRef.current.get(item.id) !== xhr) return;
        xhr.open('POST', withTargetUserRef.current('/api/books/upload'));
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        const formData = new FormData();
        formData.append('files', item.file);
        xhr.send(formData);
      })();
    }
  }, [items, maxConcurrent]);

  const addFiles = useCallback((files: FileList) => {
    const newItems: UploadItem[] = Array.from(files).map((file) => ({
      id: String(nextIdRef.current++),
      file,
      status: 'queued' as const,
      bytesUploaded: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  // Applies one or more proposed fixes as a single PATCH, then — only if the
  // patch succeeds — removes them from the item's pending proposals and
  // records them as applied. A PATCH may return a new book id (e.g. when the
  // id itself is derived from the fixed metadata), which we must track so
  // subsequent fixes patch the right book. On failure the item is left
  // untouched so the user can retry.
  const applyPatch = useCallback(
    async (itemId: string, fixes: MetadataFix[]): Promise<boolean> => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (fixes.length === 0) return true;
      if (!item?.bookId) return false;
      const patch: Partial<BookMetadataPatch> = {};
      for (const fix of fixes) Object.assign(patch, changesToPatch(fix.changes));
      const newId = await patchBookMetadata(item.bookId, patch);
      if (newId === undefined) return false;
      const applied = new Set(fixes.map(fixKey));
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                bookId: newId,
                proposals: (i.proposals ?? []).filter((p) => !applied.has(fixKey(p))),
                appliedFixes: [...(i.appliedFixes ?? []), ...fixes],
              }
            : i
        )
      );
      return true;
    },
    [patchBookMetadata]
  );

  const applyFix = useCallback(
    (itemId: string, fix: MetadataFix) => applyPatch(itemId, [fix]),
    [applyPatch]
  );

  const applyAllProposals = useCallback(
    (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      return applyPatch(
        itemId,
        (item?.proposals ?? []).filter((p) => p.to !== null)
      );
    },
    [applyPatch]
  );

  const dismissFix = useCallback((itemId: string, fix: MetadataFix) => {
    const key = fixKey(fix);
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId
          ? { ...i, proposals: (i.proposals ?? []).filter((p) => fixKey(p) !== key) }
          : i
      )
    );
  }, []);

  return { items, addFiles, applyFix, applyAllProposals, dismissFix };
};
