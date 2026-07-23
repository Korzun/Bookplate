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

/** Snapshot armed after `applyAllProposals`/`dismissAllProposals` so the user
 * can undo that bulk action. `apply` also carries the book's pre-patch
 * metadata (when the snapshot GET succeeded) so `undo` can revert it. */
export type UndoSnapshot = {
  kind: 'apply' | 'dismiss';
  proposals: MetadataFix[];
  appliedFixes: MetadataFix[];
  originalMetadata?: Partial<BookMetadataPatch>;
};

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  bytesUploaded: number;
  errorMessage?: string;
  validation?: ValidationFailure;
  bookId?: string;
  /** High-confidence fixes the server applied during upload (informational). */
  autoFixes?: MetadataFix[];
  appliedFixes?: MetadataFix[];
  proposals?: MetadataFix[];
  undo?: UndoSnapshot;
};

export type UseUploadQueue = {
  items: UploadItem[];
  addFiles: (files: FileList) => void;
  applyFix: (itemId: string, fix: MetadataFix) => Promise<boolean>;
  applyAllProposals: (itemId: string) => Promise<boolean>;
  dismissAllProposals: (itemId: string) => void;
  dismissFix: (itemId: string, fix: MetadataFix) => void;
  undo: (itemId: string) => Promise<boolean>;
};

/** Fixes have no server id — the queue identifies them by field:kind:from so
 * multiple compound-subject splits (same field+kind, different compound) stay
 * distinct. */
export const fixKey = (fix: MetadataFix): string => `${fix.field}:${fix.kind}:${fix.from}`;

const isSubjectSplit = (fix: MetadataFix): boolean =>
  fix.field === 'subjects' && fix.kind === 'subjects-split';

/** Replace `compound` (case-insensitive) with `parts` in a subjects array,
 * de-duplicating case-insensitively. Adds the parts if the compound is gone. */
function applySplit(subjects: string[], compound: string, parts: string[]): string[] {
  const idx = subjects.findIndex((s) => s.toLowerCase() === compound.toLowerCase());
  const next =
    idx >= 0
      ? [...subjects.slice(0, idx), ...parts, ...subjects.slice(idx + 1)]
      : [...subjects, ...parts];
  return next.filter((s, i) => next.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i);
}

/** The PATCH hook accepts scalar strings and `subjects: string[]`; the fix's
 * `changes` map already matches that shape field-by-field. */
function changesToPatch(changes: Record<string, string | string[]>): Partial<BookMetadataPatch> {
  return { ...changes } as Partial<BookMetadataPatch>;
}

/** Fetch a book's editable fields for a pre-apply undo snapshot. Best-effort:
 * returns null on any failure (the caller applies without offering undo). */
async function fetchBookSnapshot(
  bookId: string,
  url: (path: string) => string
): Promise<Partial<BookMetadataPatch> | null> {
  try {
    const res = await apiFetch(url(`/api/books/${encodeURIComponent(bookId)}`));
    if (!res.ok) return null;
    const b = (await res.json()) as {
      title?: string;
      titleSort?: string;
      author?: string;
      authorSort?: string;
      subjects?: string[];
    };
    return {
      title: b.title ?? '',
      titleSort: b.titleSort ?? '',
      author: b.author ?? '',
      authorSort: b.authorSort ?? '',
      subjects: b.subjects ?? [],
    };
  } catch {
    return null;
  }
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
                    autoFixes: result?.applied ?? [],
                    appliedFixes: [],
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
  //
  // Subject-split fixes are compositional rather than a plain `changes` merge:
  // PATCH /metadata replaces the whole `subjects` array, so a split must be
  // folded into the book's CURRENT subjects. `knownSubjects` lets a caller
  // that already has a fresh snapshot (e.g. `applyAllProposals`) skip a
  // redundant GET; otherwise this fetches one. If that GET fails there's no
  // safe base to fold into, so the apply fails without patching anything.
  const applyPatch = useCallback(
    async (itemId: string, fixes: MetadataFix[], knownSubjects?: string[]): Promise<boolean> => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (fixes.length === 0) return true;
      if (!item?.bookId) return false;

      const subjectFixes = fixes.filter(isSubjectSplit);
      const patch: Partial<BookMetadataPatch> = {};
      for (const fix of fixes) {
        if (!isSubjectSplit(fix)) Object.assign(patch, changesToPatch(fix.changes));
      }

      if (subjectFixes.length > 0) {
        let subjects = knownSubjects;
        if (subjects === undefined) {
          const snap = await fetchBookSnapshot(item.bookId, withTargetUserRef.current);
          if (!snap) return false; // can't safely apply a split without current subjects
          subjects = snap.subjects ?? [];
        }
        for (const fix of subjectFixes) {
          subjects = applySplit(subjects, fix.fromChips?.[0] ?? fix.from, fix.toChips ?? []);
        }
        patch.subjects = subjects;
      }

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

  // Applies every pending proposal as one PATCH. Before doing so, best-effort
  // snapshots the book's current metadata so `undo` can revert it later — the
  // apply itself proceeds even when the snapshot GET fails, it just leaves no
  // undo armed. The item is re-read from itemsRef after the snapshot GET
  // (rather than reusing the pre-await reference) so a concurrent mutation —
  // e.g. a per-row dismissFix while the GET is in flight — is respected
  // instead of being clobbered by a stale proposal list. `item.bookId` itself
  // can't change during the GET since `patchBookMetadata` is single-flight.
  const applyAllProposals = useCallback(
    async (itemId: string): Promise<boolean> => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item?.bookId) return false;
      const originalMetadata = await fetchBookSnapshot(item.bookId, withTargetUserRef.current);
      const current = itemsRef.current.find((i) => i.id === itemId);
      if (!current?.bookId) return false;
      const toApply = (current.proposals ?? []).filter((p) => p.to !== null);
      if (toApply.length === 0) return true;
      const beforeProposals = current.proposals ?? [];
      const beforeApplied = current.appliedFixes ?? [];
      const ok = await applyPatch(itemId, toApply, originalMetadata?.subjects);
      if (!ok) return false;
      if (originalMetadata) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  undo: {
                    kind: 'apply',
                    proposals: beforeProposals,
                    appliedFixes: beforeApplied,
                    originalMetadata,
                  },
                }
              : i
          )
        );
      }
      return true;
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

  // Client-only: clears every pending proposal and arms an undo snapshot so
  // the user can bring them back without re-uploading.
  const dismissAllProposals = useCallback((itemId: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        const proposals = i.proposals ?? [];
        if (proposals.length === 0) return i;
        return {
          ...i,
          proposals: [],
          undo: { kind: 'dismiss', proposals, appliedFixes: i.appliedFixes ?? [] },
        };
      })
    );
  }, []);

  // Reverses the last dismiss-all or apply-all. For `dismiss` this is purely
  // client-side. For `apply` it re-PATCHes the (now current) book back to the
  // pre-apply metadata — which, like any metadata patch, may mint a new book
  // id — then best-effort clears that book's edit lineage so the reverted
  // book doesn't retain stale fix history. The lineage DELETE's failure never
  // blocks the revert since the metadata is already back to original by then.
  const undo = useCallback(
    async (itemId: string): Promise<boolean> => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item?.undo) return true;
      const snap = item.undo;

      if (snap.kind === 'dismiss') {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId ? { ...i, proposals: snap.proposals, undo: undefined } : i
          )
        );
        return true;
      }

      if (!item.bookId) return false;
      let revertedId = item.bookId;
      if (snap.originalMetadata) {
        const newId = await patchBookMetadata(item.bookId, snap.originalMetadata);
        if (newId === undefined) return false; // revert failed — keep applied state + undo
        revertedId = newId;
      }
      try {
        await apiFetch(
          withTargetUserRef.current(`/api/books/${encodeURIComponent(revertedId)}/lineage`),
          { method: 'DELETE' }
        );
      } catch {
        // Best-effort: the revert stands even if lineage cleanup fails.
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                bookId: revertedId,
                proposals: snap.proposals,
                appliedFixes: snap.appliedFixes,
                undo: undefined,
              }
            : i
        )
      );
      return true;
    },
    [patchBookMetadata]
  );

  return {
    items,
    addFiles,
    applyFix,
    applyAllProposals,
    dismissAllProposals,
    dismissFix,
    undo,
  };
};
