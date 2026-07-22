import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MetadataFix } from '~/provider/book';
import { renderWithProviders } from '~/test-utils';

import { UploadPage } from './index';

// ── XHR mock (same shape as use-upload-queue.test.tsx) ────────────────────────

let xhrInstances: XHRMock[];

class XHRMock {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: ((e: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  responseText = '{}';
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  setRequestHeader = vi.fn();
  constructor() {
    xhrInstances.push(this);
  }
}

function makeFix(overrides: Partial<MetadataFix> = {}): MetadataFix {
  return {
    field: 'authorSort',
    kind: 'author-sort-missing',
    from: '',
    to: 'Herbert, Frank',
    changes: { authorSort: 'Herbert, Frank' },
    ...overrides,
  };
}

beforeEach(() => {
  xhrInstances = [];
  vi.stubGlobal('XMLHttpRequest', XHRMock);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ maxConcurrentUploads: 2 }),
        });
      }
      if (url.includes('/metadata') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'book-2' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: [], books: [], nextCursor: null }),
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

// ── Regression test for Fix 3 ─────────────────────────────────────────────────
//
// An item that uploads with no server auto-fixes must never be announced.
// Previously it was never added to `announcedRef`, so a later *manual* Apply
// (which moves a fix into appliedFixes) tripped the "Auto-fixed" effect and
// fired a misleading toast. This mounts the real UploadPage (with only the
// leaf providers that have real state — everything else uses its context's
// default no-op value) and drives an upload + manual apply end-to-end.

describe('UploadPage — manual apply does not trigger the auto-fix toast', () => {
  it('shows no "Auto-fixed" toast for a manually-applied proposal', async () => {
    const fix = makeFix();

    renderWithProviders(<UploadPage />);

    // Let the initial config/scan-status fetches settle.
    await act(async () => {
      await Promise.resolve();
    });

    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const file = new File(['x'.repeat(1000)], 'a.epub');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(xhrInstances).toHaveLength(1);

    // Upload completes with zero server auto-fixes, one proposal pending.
    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [{ filename: 'a.epub', bookId: 'book-1', applied: [], proposals: [fix] }],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    // Nothing was auto-fixed — no toast yet.
    expect(screen.queryByText(/Auto-fixed/)).toBeNull();

    // The user manually applies the proposed fix.
    const applyButton = screen.getByRole('button', { name: /^apply$/i });
    await act(async () => {
      fireEvent.click(applyButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/Herbert, Frank/)).toBeInTheDocument();
    });

    // A manual apply must never surface the batch "Auto-fixed" toast.
    expect(screen.queryByText(/Auto-fixed/)).toBeNull();
  });
});
