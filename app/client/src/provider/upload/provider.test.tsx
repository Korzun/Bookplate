import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookProvider } from '~/provider/book';
import { LibraryTargetProvider } from '~/provider/library-target';
import { ApolloTestProvider } from '~/test-utils';

import { useUploadQueue } from './hook';
import { UploadProvider } from './provider';

function Probe() {
  const { items } = useUploadQueue();
  return <div>count:{items.length}</div>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/books/pending-fixes')) {
        return {
          ok: true,
          json: async () => [
            {
              bookId: 'b1',
              fileName: 'x.epub',
              fileSize: 10,
              autoFixes: [],
              appliedFixes: [],
              proposals: [{ field: 'title', kind: 'k', from: 'a', to: 'b', changes: {} }],
              undo: null,
            },
          ],
        };
      }
      return { ok: true, json: async () => ({ maxConcurrentUploads: 3 }) };
    }) as never
  );
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('UploadProvider', () => {
  it('seeds the queue from the server pending-fixes on mount', async () => {
    render(
      <ApolloTestProvider>
        <MemoryRouter>
          <LibraryTargetProvider>
            <BookProvider>
              <UploadProvider>
                <Probe />
              </UploadProvider>
            </BookProvider>
          </LibraryTargetProvider>
        </MemoryRouter>
      </ApolloTestProvider>
    );

    expect(await screen.findByText('count:1')).toBeTruthy();
  });
});
