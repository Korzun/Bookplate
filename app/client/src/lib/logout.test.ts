import { beforeEach, expect, it, vi } from 'vitest';

import { consumeLoggedOutMark, logout } from './logout';
import { getToken, setToken } from './token';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('clears the token and redirects even when the server call fails', async () => {
  setToken('t');
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
  const assign = vi.fn();
  vi.stubGlobal('location', {
    ...window.location,
    set href(v: string) {
      assign(v);
    },
  });

  await logout();

  // Best-effort: a failed POST must NOT block the local teardown.
  expect(getToken()).toBeNull();
  expect(assign).toHaveBeenCalledWith('/login');
});

it('arms the one-shot mark so the next bootstrap refresh is skipped', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('location', { ...window.location, set href(_v: string) {} });

  await logout();

  expect(consumeLoggedOutMark()).toBe(true);
  // ONE shot: a second read must be false, or a later legitimate login would
  // have its own bootstrap refresh suppressed too.
  expect(consumeLoggedOutMark()).toBe(false);
});

it('reports no mark when nothing armed it', () => {
  expect(consumeLoggedOutMark()).toBe(false);
});
