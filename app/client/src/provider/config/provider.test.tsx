import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEmailEnabled } from '.';
import { ConfigProvider } from './provider';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('useEmailEnabled', () => {
  it('is false before the fetch resolves and true once /api/public-config answers', async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const { result } = renderHook(() => useEmailEnabled(), { wrapper: ConfigProvider });
    expect(result.current).toBe(false);

    resolveFetch(
      new Response(JSON.stringify({ libraryName: 'Bookplate', emailEnabled: true }), {
        status: 200,
      })
    );

    await waitFor(() => expect(result.current).toBe(true));
  });
});
