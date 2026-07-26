import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownloadBook } from './use-download-book';

describe('useDownloadBook', () => {
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          click: clickSpy,
          remove: vi.fn(),
        } as unknown as HTMLElement;
      }
      // Delegate to the real implementation so testing-library's own container
      // (a real <div>) still works; only anchor creation is faked.
      return realCreateElement(tag);
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
