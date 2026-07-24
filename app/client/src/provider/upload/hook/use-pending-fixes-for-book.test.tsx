import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { UploadItem, UseUploadQueue } from '~/provider/book';

import { UploadContext } from '../context';
import { usePendingFixesForBook } from './use-pending-fixes-for-book';
import { useUploadBadge } from './use-upload-badge';

const base: UseUploadQueue = {
  items: [],
  addFiles: () => {},
  applyFix: async () => false,
  applyAllProposals: async () => false,
  dismissAllProposals: () => {},
  dismissFix: () => {},
  undo: async () => false,
};

function item(overrides: Partial<UploadItem>): UploadItem {
  return {
    id: '1',
    fileName: 'a.epub',
    fileSize: 1,
    status: 'done',
    bytesUploaded: 1,
    ...overrides,
  };
}

function wrapperFor(items: UploadItem[]) {
  return ({ children }: { children: ReactNode }) => (
    <UploadContext.Provider value={{ ...base, items }}>{children}</UploadContext.Provider>
  );
}

const prop = { field: 'title', kind: 'x', from: 'a', to: 'b', changes: {} } as never;

describe('usePendingFixesForBook', () => {
  it('returns the item when that book has pending proposals', () => {
    const items = [item({ bookId: 'b1', proposals: [prop] })];
    const { result } = renderHook(() => usePendingFixesForBook('b1'), {
      wrapper: wrapperFor(items),
    });
    expect(result.current?.bookId).toBe('b1');
  });
  it('returns undefined when the book has no pending proposals', () => {
    const items = [item({ bookId: 'b1', proposals: [] })];
    const { result } = renderHook(() => usePendingFixesForBook('b1'), {
      wrapper: wrapperFor(items),
    });
    expect(result.current).toBeUndefined();
  });
  it('returns undefined for an unknown / missing bookId', () => {
    const { result } = renderHook(() => usePendingFixesForBook(undefined), {
      wrapper: wrapperFor([]),
    });
    expect(result.current).toBeUndefined();
  });
});

describe('useUploadBadge', () => {
  it('counts items with pending proposals', () => {
    const items = [
      item({ bookId: 'b1', proposals: [prop] }),
      item({ id: '2', bookId: 'b2', proposals: [prop] }),
    ];
    const { result } = renderHook(() => useUploadBadge(), { wrapper: wrapperFor(items) });
    expect(result.current).toEqual({ count: 2, active: false });
  });
  it('reports active while an upload is in progress', () => {
    const items = [item({ id: '3', status: 'uploading', proposals: [] })];
    const { result } = renderHook(() => useUploadBadge(), { wrapper: wrapperFor(items) });
    expect(result.current).toEqual({ count: 0, active: true });
  });
});
