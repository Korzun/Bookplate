import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Context, type AuthContext } from '../context';

import { useMustChangePassword } from './use-must-change-password';

const baseState: AuthContext = {
  username: 'alice',
  userId: 'u1',
  isAdmin: false,
  mustChangePassword: false,
  loading: false,
};

describe('useMustChangePassword', () => {
  it('returns false by default', () => {
    const { result } = renderHook(() => useMustChangePassword(), {
      wrapper: ({ children }) => <Context.Provider value={baseState}>{children}</Context.Provider>,
    });
    expect(result.current[0]).toBe(false);
  });

  it('returns true when the context flag is set', () => {
    const { result } = renderHook(() => useMustChangePassword(), {
      wrapper: ({ children }) => (
        <Context.Provider value={{ ...baseState, mustChangePassword: true }}>
          {children}
        </Context.Provider>
      ),
    });
    expect(result.current[0]).toBe(true);
  });
});
