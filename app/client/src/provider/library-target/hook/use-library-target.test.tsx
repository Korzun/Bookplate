import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';

import { LibraryTargetProvider } from '~/provider/library-target';

import { useLibraryTarget } from './use-library-target';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LibraryTargetProvider>{children}</LibraryTargetProvider>
);

afterEach(() => {
  localStorage.clear();
});

it('ignores a legacy username under the old key', () => {
  localStorage.setItem('library-target-user', 'alice');
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  expect(result.current[0]).toBeUndefined();
});

it('persists a selected Library global ID', () => {
  const { result } = renderHook(() => useLibraryTarget(), { wrapper });
  act(() => result.current[1]('TGlicmFyeTox'));
  expect(localStorage.getItem('library-target-id')).toBe('TGlicmFyeTox');
});
