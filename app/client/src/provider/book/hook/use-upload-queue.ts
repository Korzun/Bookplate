import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { getToken } from '../../../lib/token';
import { Context } from '../context';

import { useFetchBookList } from './use-fetch-book-list';

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'error';

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  bytesUploaded: number;
  errorMessage?: string;
};

export type UseUploadQueue = {
  items: UploadItem[];
  addFiles: (files: FileList) => void;
};

export const useUploadQueue = (): UseUploadQueue => {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const fetchBookList = useFetchBookList();
  const { clearCompleteBookIds } = useContext(Context);

  // IDs of items whose XHR has been created — prevents double-starting across renders
  const startedRef = useRef(new Set<string>());
  // Active XHRs keyed by item ID — used for cleanup on unmount
  const xhrMapRef = useRef(new Map<string, XMLHttpRequest>());
  // Stable counter for generating unique IDs within this hook instance
  const nextIdRef = useRef(0);
  // Stable refs to avoid stale closure captures inside xhr.onload
  const fetchBookListRef = useRef(fetchBookList);
  const clearCompleteBookIdsRef = useRef(clearCompleteBookIds);
  useLayoutEffect(() => {
    fetchBookListRef.current = fetchBookList;
    clearCompleteBookIdsRef.current = clearCompleteBookIds;
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
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: 'done' as const, bytesUploaded: item.file.size }
                : i
            )
          );
          clearCompleteBookIdsRef.current();
          void fetchBookListRef.current();
        } else {
          let errorMessage: string | undefined;
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            errorMessage = data.error;
          } catch {
            // no structured error
          }
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: 'error' as const, errorMessage } : i
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

      xhr.open('POST', '/api/books/upload');
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      const formData = new FormData();
      formData.append('files', item.file);
      xhr.send(formData);
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

  return { items, addFiles };
};
