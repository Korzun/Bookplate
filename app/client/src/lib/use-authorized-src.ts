import { useEffect, useState } from 'react';

import { apiFetch } from './api-fetch';

export function useAuthorizedSrc(url: string | null): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!url) return;

    let objectUrl: string | undefined;
    let cancelled = false;

    apiFetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err) => {
        if (import.meta.env.DEV) console.error('[useAuthorizedSrc]', err);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(undefined);
    };
  }, [url]);

  return src;
}
