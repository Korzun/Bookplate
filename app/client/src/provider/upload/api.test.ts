import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPendingFixes, putPendingFix, deletePendingFix } from './api';

const withUser = (p: string) => `${p}?user=alice`;

afterEach(() => vi.unstubAllGlobals());

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

describe('pending-fixes api', () => {
  it('getPendingFixes GETs the target-scoped URL and returns rows', async () => {
    const rows = [
      {
        bookId: 'b1',
        fileName: 'x',
        fileSize: 1,
        autoFixes: [],
        appliedFixes: [],
        proposals: [],
        undo: null,
      },
    ];
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({ ok: true, json: async () => rows }));
    vi.stubGlobal('fetch', fetchMock as never);
    expect(await getPendingFixes(withUser)).toEqual(rows);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/books/pending-fixes?user=alice');
  });

  it('putPendingFix PUTs the body', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock as never);
    await putPendingFix(withUser, 'b1', {
      fileName: 'x',
      fileSize: 1,
      state: { autoFixes: [], appliedFixes: [], proposals: [], undo: null },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/books/b1/pending-fixes');
    expect(init?.method).toBe('PUT');
  });

  it('deletePendingFix DELETEs', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock as never);
    await deletePendingFix(withUser, 'b1');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
