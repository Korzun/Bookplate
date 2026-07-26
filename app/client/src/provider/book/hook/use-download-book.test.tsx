import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownloadBook } from './use-download-book';

describe('useDownloadBook', () => {
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      // Delegate to the real implementation so testing-library's own container
      // (a real <div>) and document.body.appendChild(anchor) both keep working;
      // only the anchor's `click` is faked so it doesn't trigger a real navigation.
      const el = realCreateElement(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy as unknown as () => void;
      }
      return el;
    }) as typeof document.createElement);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the download URL (URL-encoded) and triggers an anchor click on success', async () => {
    const blob = new Blob(['EPUB']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => blob,
        headers: { get: () => "attachment; filename*=UTF-8''My_Book.epub" },
      })
    );

    const { result } = renderHook(() => useDownloadBook());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current[0]('book/1');
    });

    expect(returned).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`/api/books/${encodeURIComponent('book/1')}/download`, {});
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('returns false and does not click on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useDownloadBook());
    let returned: boolean | undefined = true;
    await act(async () => {
      returned = await result.current[0]('1');
    });

    expect(returned).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
