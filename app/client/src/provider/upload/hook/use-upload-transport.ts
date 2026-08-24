import { useQuery } from '@apollo/client/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { UploadConfigDocument } from '~/graphql/upload';
import { ensureFreshToken } from '~/lib/api-fetch';
import type { ValidationFailure } from '~/lib/severity';
import type { MetadataFix, UploadFileResult } from '~/provider/book/type';
import { useWithTargetUser } from '~/provider/library-target';

export type TransportStatus = 'queued' | 'uploading' | 'done' | 'error';

export type TransportItem = {
  /** Session counter, never a book id. */
  id: string;
  fileName: string;
  fileSize: number;
  status: TransportStatus;
  bytesUploaded: number;
  errorMessage?: string;
  validation?: ValidationFailure;
  /** Relay global id, from the upload response's `globalId`. The raw
   * content-hash `bookId` is deliberately never stored here — see the
   * Global Constraints in this migration's spec: no raw book id may appear
   * anywhere under `provider/upload/`. */
  bookGlobalId?: string;
  /** High-confidence fixes the server applied during upload (informational). */
  autoFixes?: MetadataFix[];
  proposals?: MetadataFix[];
};

export type UseUploadTransport = {
  items: TransportItem[];
  addFiles: (files: FileList) => void;
  /** Removes a row locally. Replaces the local half of the old
   * `dismissCompleted`; the server half becomes a `CLEAR` mutation
   * elsewhere. */
  dropItem: (id: string) => void;
};

/** Internal item shape — carries the picked `File` alongside the publicly
 * exposed `TransportItem` fields so the rolling-concurrency effect can read
 * it back when starting an upload. */
type Item = TransportItem & { file?: File };

/**
 * The REST half of the upload queue: multipart POST + XHR, kept as REST
 * because XHR's `upload.onprogress` is the only way to get upload progress —
 * sanctioned seam 3 of this migration.
 *
 * Everything else the old `provider/book/hook/use-upload-queue.ts` did (fix
 * state, server sync, fix operations) is server-owned now and does not
 * belong here.
 *
 * `onUploaded` fires once per successful upload, with no arguments — the
 * caller decides what to refetch/evict, and doesn't need to know which book
 * arrived.
 */
export const useUploadTransport = (onUploaded: () => void): UseUploadTransport => {
  const [items, setItems] = useState<Item[]>([]);
  // Replaces GET /api/config. Defaults to 3 while loading or on error,
  // exactly as the old REST fetch's `.catch()` did.
  const { data } = useQuery(UploadConfigDocument);
  const maxConcurrent = data?.config.maxConcurrentUploads ?? 3;
  const withTargetUser = useWithTargetUser();

  // IDs of items whose XHR has been created — prevents double-starting across renders
  const startedRef = useRef(new Set<string>());
  // Active XHRs keyed by item ID — lets progress/load/error handlers correlate
  // events with the in-flight request during the upload lifecycle
  const xhrMapRef = useRef(new Map<string, XMLHttpRequest>());
  // Stable counter for generating unique IDs within this hook instance
  const nextIdRef = useRef(0);
  // Stable refs to avoid stale closure captures inside xhr.onload
  const withTargetUserRef = useRef(withTargetUser);
  const onUploadedRef = useRef(onUploaded);
  useLayoutEffect(() => {
    withTargetUserRef.current = withTargetUser;
    onUploadedRef.current = onUploaded;
  });

  // Rolling concurrency: start uploads whenever a slot is free
  useEffect(() => {
    const inFlight = startedRef.current.size;
    const slots = maxConcurrent - inFlight;
    if (slots <= 0) return;

    const toStart = items
      .filter((i) => i.status === 'queued' && !!i.file && !startedRef.current.has(i.id))
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
            const parsed = JSON.parse(xhr.responseText) as { results?: UploadFileResult[] };
            result = parsed.results?.[0];
          } catch {
            // no structured result
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: 'done' as const,
                    bytesUploaded: item.fileSize,
                    bookGlobalId: result?.globalId,
                    autoFixes: result?.applied ?? [],
                    proposals: result?.proposals ?? [],
                  }
                : i
            )
          );
          onUploadedRef.current();
        } else {
          let errorMessage: string | undefined;
          let validation: ValidationFailure | undefined;
          try {
            const parsed = JSON.parse(xhr.responseText) as {
              error?: string;
              validation?: ValidationFailure;
            };
            errorMessage = parsed.error;
            validation = parsed.validation;
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
        if (!item.file) return; // TS-only guard: toStart is filtered to items with a file
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
    const newItems: Item[] = Array.from(files).map((file) => ({
      id: String(nextIdRef.current++),
      file,
      fileName: file.name,
      fileSize: file.size,
      status: 'queued' as const,
      bytesUploaded: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const dropItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return { items, addFiles, dropItem };
};
