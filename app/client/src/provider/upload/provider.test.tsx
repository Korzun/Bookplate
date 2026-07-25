import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookProvider } from '~/provider/book';
import { LibraryTargetProvider } from '~/provider/library-target';

import { useUploadQueue } from './hook';
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
  it('starts with an empty queue', () => {
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

    expect(screen.getByText('count:0')).toBeTruthy();
  });
});
