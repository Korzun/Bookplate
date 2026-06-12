import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  mockApiFetch.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:test-url');
  revokeObjectURL.mockReset();
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
});
