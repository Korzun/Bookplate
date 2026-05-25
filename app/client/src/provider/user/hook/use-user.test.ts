import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUser } from './use-user';
import type { UseUserList } from './use-user-list';

vi.mock('./use-user-list');

const { useUserList } = await import('./use-user-list');
const mockUseUserList = vi.mocked(useUserList);

function stubList(tuple: UseUserList) {
  mockUseUserList.mockReturnValue(tuple);
}

describe('useUser', () => {
  it('returns the user when found in the list', () => {
    stubList([[{ username: 'alice', progressCount: 2 }], false, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toEqual({ username: 'alice', progressCount: 2 });
    expect(result.current[1]).toBe(false);
    expect(result.current[2]).toBe(false);
    expect(result.current[3]).toBeUndefined();
  });

  it('returns loading state when list is loading and user is absent', () => {
    stubList([[], true, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });

  it('returns unknown-user error when list loaded but user absent', () => {
    stubList([[{ username: 'bob', progressCount: 0 }], false, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Unknown user alice');
  });

  it('propagates error from useUserList', () => {
    stubList([[], false, true, 'Fetch failed']);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toBeUndefined();
    expect(result.current[2]).toBe(true);
    expect(result.current[3]).toBe('Fetch failed');
  });

  it('returns user alongside loading when list is refreshing', () => {
    stubList([[{ username: 'alice', progressCount: 0 }], true, false, undefined]);
    const { result } = renderHook(() => useUser('alice'));
    expect(result.current[0]).toEqual({ username: 'alice', progressCount: 0 });
    expect(result.current[1]).toBe(true);
    expect(result.current[2]).toBe(false);
  });
});
