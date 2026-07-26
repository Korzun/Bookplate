import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useValidateBook } from './use-validate-book';

const REPORT = { valid: false, threshold: 'ERROR', counts: {}, messages: [] };

describe('useValidateBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the encoded validate URL and returns the report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => REPORT }));
    const { result } = renderHook(() => useValidateBook());
    let out: unknown;
    await act(async () => {
      out = await result.current[0]('book/1');
    });
    expect(fetch).toHaveBeenCalledWith(`/api/books/${encodeURIComponent('book/1')}/validate`, {
      method: 'POST',
    });
    expect(out).toEqual(REPORT);
  });

  it('returns undefined on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useValidateBook());
    let out: unknown = 'x';
    await act(async () => {
      out = await result.current[0]('1');
    });
    expect(out).toBeUndefined();
  });
});
