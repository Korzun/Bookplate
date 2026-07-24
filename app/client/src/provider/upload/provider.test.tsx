import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookProvider } from '~/provider/book';
import { LibraryTargetProvider } from '~/provider/library-target';

import { useUploadQueue } from './hook';
import { STORAGE_KEY } from './persistence';
import { UploadProvider } from './provider';

function Probe() {
  const { items } = useUploadQueue();
  return <div>count:{items.length}</div>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ maxConcurrentUploads: 3 }) })) as never
  );
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('UploadProvider', () => {
  it('hydrates the queue from localStorage and shares it via context', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: 'r1',
          fileName: 'restored.epub',
          fileSize: 10,
          status: 'done',
          bytesUploaded: 10,
          bookId: 'b1',
          proposals: [{ field: 'title', kind: 'x', from: 'a', to: 'b', changes: {} }],
        },
      ])
    );

    render(
      <MemoryRouter>
        <LibraryTargetProvider>
          <BookProvider>
            <UploadProvider>
              <Probe />
            </UploadProvider>
          </BookProvider>
        </LibraryTargetProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('count:1')).toBeTruthy();
  });
});
