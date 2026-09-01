import { describe, expect, it } from 'vitest';

import { toastReducer, type ToastEntry } from './reducer';

describe('toastReducer', () => {
  it('carries the toast type through an add (including info)', () => {
    const state = toastReducer([], {
      type: 'add',
      id: 1,
      message: 'Uploading…',
      toastType: 'info',
      maxToasts: 3,
    });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: 1, message: 'Uploading…', type: 'info' });
  });

  it('preserves success and error types', () => {
    const entries: ToastEntry[] = ['success', 'error']
      .map((t, i) =>
        toastReducer([], {
          type: 'add',
          id: i,
          message: t,
          toastType: t as 'success' | 'error',
          maxToasts: 3,
        })
      )
      .map((s) => s[0]);
    expect(entries.map((e) => e.type)).toEqual(['success', 'error']);
  });
});
