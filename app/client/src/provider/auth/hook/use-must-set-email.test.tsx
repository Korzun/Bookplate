import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Context, type AuthContext } from '../context';
import { useMustSetEmail } from './use-must-set-email';

const baseState: AuthContext = {
  username: 'alice',
  userId: 'u1',
  isAdmin: false,
  mustChangePassword: false,
  mustSetEmail: false,
  loading: false,
};

describe('useMustSetEmail', () => {
  it('returns false by default', () => {
    const { result } = renderHook(() => useMustSetEmail(), {
      wrapper: ({ children }) => <Context.Provider value={baseState}>{children}</Context.Provider>,
    });
    expect(result.current[0]).toBe(false);
  });

  it('returns true when the context flag is set', () => {
    const { result } = renderHook(() => useMustSetEmail(), {
      wrapper: ({ children }) => (
        <Context.Provider value={{ ...baseState, mustSetEmail: true }}>{children}</Context.Provider>
      ),
    });
    expect(result.current[0]).toBe(true);
  });
});
