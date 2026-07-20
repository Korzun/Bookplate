import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('./api-fetch');

import { apiFetch } from './api-fetch';
import { useAuthorizedSrc } from './use-authorized-src';

const mockApiFetch = vi.mocked(apiFetch);

const makeOkResponse = (blob: Blob) => ({
  ok: true,
  blob: () => Promise.resolve(blob),
});

const createObjectURL = vi.fn(() => 'blob:test-url');
const revokeObjectURL = vi.fn();

const origCreateObjectURL = URL.createObjectURL;
const origRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  mockApiFetch.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:test-url');
  revokeObjectURL.mockReset();
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
});

describe('useAuthorizedSrc', () => {
  it('returns undefined and makes no fetch when url is null', () => {
    const { result } = renderHook(() => useAuthorizedSrc(null));
    expect(result.current).toBeUndefined();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('fetches the url via apiFetch and returns a blob URL', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { result } = renderHook(() => useAuthorizedSrc('/api/books/book1/cover'));

    await waitFor(() => expect(result.current).toBe('blob:test-url'));
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book1/cover');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('returns undefined for a non-ok response without creating a blob URL', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false } as Response);

    const { result } = renderHook(() => useAuthorizedSrc('/api/books/book1/cover'));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book1/cover'));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it('revokes the old blob URL and fetches a new one when url changes', async () => {
    const blob1 = new Blob(['img1'], { type: 'image/jpeg' });
    const blob2 = new Blob(['img2'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:url-1').mockReturnValueOnce('blob:url-2');
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(blob1) as Response)
      .mockResolvedValueOnce(makeOkResponse(blob2) as Response);

    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useAuthorizedSrc(url),
      { initialProps: { url: '/api/books/book1/cover' } }
    );

    await waitFor(() => expect(result.current).toBe('blob:url-1'));

    rerender({ url: '/api/books/book2/cover' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');

    await waitFor(() => expect(result.current).toBe('blob:url-2'));
  });

  it('revokes the blob URL on unmount', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:to-revoke');
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { result, unmount } = renderHook(() => useAuthorizedSrc('/api/books/book3/cover'));

    await waitFor(() => expect(result.current).toBe('blob:to-revoke'));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:to-revoke');
  });

  it('revokes the blob URL and clears src when url changes to null', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:url-to-clear');
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useAuthorizedSrc(url),
      { initialProps: { url: '/api/books/book1/cover' as string | null } }
    );

    await waitFor(() => expect(result.current).toBe('blob:url-to-clear'));

    rerender({ url: null });

    await waitFor(() => expect(result.current).toBeUndefined());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-to-clear');
  });

  it('revokes the old blob URL and clears src when the new fetch returns non-ok', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:stale-url');
    mockApiFetch
      .mockResolvedValueOnce(makeOkResponse(blob) as Response)
      .mockResolvedValueOnce({ ok: false } as Response);

    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useAuthorizedSrc(url),
      { initialProps: { url: '/api/books/book1/cover' as string | null } }
    );

    await waitFor(() => expect(result.current).toBe('blob:stale-url'));

    rerender({ url: '/api/books/book2/cover' });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:stale-url');
    expect(result.current).toBeUndefined();
  });
});
