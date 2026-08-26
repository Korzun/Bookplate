import type { MockedResponse } from '@apollo/client/testing';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BookResolvePendingFixMutation,
  BookResolvePendingFixMutationVariables,
} from '~/gql/graphql';
import { BookResolvePendingFixDocument } from '~/graphql/upload';
import type { MetadataFix } from '~/lib/book-types';
import { UploadProvider } from '~/provider/upload';
import { renderWithApollo } from '~/test-utils';

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

/** An `ACCEPT`-all `BookResolvePendingFixDocument` mock for `bookGlobalId`,
 * `onResolve` firing once per actual mutation call — used to prove a
 * re-entrant "Accept all" click only fires the mutation once, and to gate
 * (via `delay`) the window a bulk apply stays "in flight" for. */
function acceptAllMock(
  bookGlobalId: string,
  onResolve: () => void = () => {},
  delay = 0
): MockedResponse<BookResolvePendingFixMutation, BookResolvePendingFixMutationVariables> {
  return {
    request: {
      query: BookResolvePendingFixDocument,
      variables: { id: bookGlobalId, action: 'ACCEPT' },
    },
    delay,
    maxUsageCount: 2, // deliberately > 1: a re-entrancy regression should show up as onResolve firing twice, not as a "no more mocked responses" error masking the real assertion
    result: () => {
      onResolve();
      return {
        data: {
          __typename: 'Mutation',
          bookResolvePendingFix: {
            __typename: 'BookResolvePendingFixPayload',
            book: { __typename: 'Book', id: bookGlobalId, title: 'X', author: 'Y' },
            library: { __typename: 'Library', id: 'LIB-1', pendingFixes: [] },
          },
        },
      };
    },
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

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

// ── Regression test for Fix 3 ─────────────────────────────────────────────────
//
// An item that uploads with no server auto-fixes must never be announced.
// Previously it was never added to `announcedRef`, so a later *manual* Accept
// (which moves a fix into appliedFixes) tripped the "Auto-fixed" effect and
// fired a misleading toast. This mounts the real UploadPage wrapped in the
// (lifted) UploadProvider — everything else uses its context's default
// no-op value — and drives an upload + manual apply end-to-end.

describe('UploadPage — manual apply does not trigger the auto-fix toast', () => {
  it('shows no "Auto-fixed" toast for a manually-applied proposal', async () => {
    const fix = makeFix();

    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>
    );

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
    const applyButton = screen.getByRole('button', { name: /^accept$/i });
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

describe('UploadPage — Clear finished', () => {
  it('is disabled with an empty queue and clears a failed row when chosen', async () => {
    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    // Every action lives in the "Actions" overflow menu now. Open it; "Clear
    // finished" is a native menu button, so its disabled state is the real
    // `disabled` attribute (toBeDisabled), not the div-based inline control's
    // aria-disabled. The menu stays open across re-renders, so we open once.
    await act(async () => {
      fireEvent.click(screen.getByText('Actions'));
    });
    const clearFinished = () => screen.getByRole('menuitem', { name: /clear finished/i });
    expect(clearFinished()).toBeDisabled();

    // Queue a file, then force the upload to fail so the row becomes clearable.
    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const file = new File(['x'.repeat(1000)], 'bad.epub');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(xhrInstances).toHaveLength(1);
    xhrInstances[0].status = 400;
    xhrInstances[0].responseText = JSON.stringify({ error: 'bad epub' });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(screen.getByText('bad.epub')).toBeInTheDocument();
    await waitFor(() => expect(clearFinished()).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(clearFinished());
      await Promise.resolve();
    });

    expect(screen.queryByText('bad.epub')).toBeNull();
  });

  it('clears only the failed row, leaving an in-progress upload untouched', async () => {
    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    // Queue two files. maxConcurrentUploads is stubbed to 2, so both start
    // uploading immediately and get their own XHR.
    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const failFile = new File(['x'.repeat(1000)], 'bad.epub');
    const pendingFile = new File(['y'.repeat(1000)], 'pending.epub');
    Object.defineProperty(fileInput, 'files', {
      value: [failFile, pendingFile],
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(xhrInstances).toHaveLength(2);

    // Drive the first upload to a failure — it becomes dismissible.
    xhrInstances[0].status = 400;
    xhrInstances[0].responseText = JSON.stringify({ error: 'bad epub' });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    // Never fire xhrInstances[1].onload — it stays 'uploading' indefinitely.

    expect(screen.getByText('bad.epub')).toBeInTheDocument();
    expect(screen.getByText('pending.epub')).toBeInTheDocument();

    // Open the Actions menu and choose Clear finished (a native menu button).
    await act(async () => {
      fireEvent.click(screen.getByText('Actions'));
    });
    const clearFinished = () => screen.getByRole('menuitem', { name: /clear finished/i });
    await waitFor(() => expect(clearFinished()).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(clearFinished());
      await Promise.resolve();
    });

    // Only the settled (failed) row is cleared; the in-progress row must survive.
    expect(screen.queryByText('bad.epub')).toBeNull();
    expect(screen.getByText('pending.epub')).toBeInTheDocument();
  });
});

describe('UploadPage — Accept all / Reject all', () => {
  it('applies every pending proposal across the queue via the Actions menu', async () => {
    const fix = makeFix();

    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const fileA = new File(['x'.repeat(1000)], 'p1.epub');
    const fileB = new File(['y'.repeat(1000)], 'p2.epub');
    Object.defineProperty(fileInput, 'files', { value: [fileA, fileB], configurable: true });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(xhrInstances).toHaveLength(2);

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [{ filename: 'p1.epub', bookId: 'book-1', applied: [], proposals: [fix] }],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    xhrInstances[1].status = 200;
    xhrInstances[1].responseText = JSON.stringify({
      results: [{ filename: 'p2.epub', bookId: 'book-2', applied: [], proposals: [fix] }],
    });
    await act(async () => {
      xhrInstances[1].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(screen.getByText('p1.epub')).toBeInTheDocument();
    expect(screen.getByText('p2.epub')).toBeInTheDocument();

    // Every action lives in the desktop bar's "Actions" overflow menu, closed
    // by default. Target the trigger by its visible text ("Actions") to avoid
    // colliding with the mobile icon trigger's accessible name.
    const moreTrigger = screen.getByText('Actions');
    await act(async () => {
      fireEvent.click(moreTrigger);
    });

    const acceptAll = screen.getByRole('menuitem', { name: /^accept all$/i });
    expect(acceptAll).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(acceptAll);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Herbert, Frank/).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('ignores a re-entrant Accept all click while the first is still in flight', async () => {
    const fix = makeFix();
    let acceptCalls = 0;

    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>,
      { mocks: [acceptAllMock('GID-1', () => acceptCalls++)] }
    );
    await act(async () => {
      await Promise.resolve();
    });

    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const file = new File(['x'.repeat(1000)], 'p1.epub');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    expect(xhrInstances).toHaveLength(1);
    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [
        { filename: 'p1.epub', bookId: 'book-1', globalId: 'GID-1', applied: [], proposals: [fix] },
      ],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    expect(screen.getByText('p1.epub')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Actions'));
    });
    const acceptAllBtn = screen.getByRole('menuitem', { name: /^accept all$/i });

    // Dispatch two clicks on the very same (still-mounted) menuitem
    // synchronously, before yielding to any microtask — React batches the
    // resulting state updates (menu close, item mutation) until we yield, so
    // both click handlers run against the same pre-click snapshot. This
    // simulates a rapid re-entrant double-click while the first invocation is
    // still inside its unresolved async chain, and pins the guarantee that it
    // can't kick off a second, parallel mutation wave over the same items.
    await act(async () => {
      fireEvent.click(acceptAllBtn);
      fireEvent.click(acceptAllBtn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The pending-fix read never got a resolved library id in this harness (no
    // `ViewerBootstrapDocument` mock), so the mutation's own cache write is
    // never observed by an active query — the proposal stays visible exactly
    // once, same as before the click. `acceptCalls` below is the real proof
    // of the guard.
    await waitFor(() => {
      expect(screen.getAllByText(/Herbert, Frank/)).toHaveLength(1);
    });

    // Without the guard, the second (re-entrant) invocation independently
    // fires `acceptFixes` again, doubling the mutation wave. `acceptAllMock`
    // allows up to two uses precisely so a regression here shows up as this
    // count, not as an unrelated "no more mocked responses" error.
    expect(acceptCalls).toBe(1);
  });

  it('disables per-upload Accept/Reject while Accept all is applying, then frees them on completion', async () => {
    const fix = makeFix();

    // `delay: 20` keeps the mutation "in flight" for a beat — long enough to
    // observe the locked state before it resolves — matching this codebase's
    // established in-flight-delay idiom for exactly this kind of assertion
    // (see e.g. `page/book/index.test.tsx`'s "disables Regen chapters while a
    // regen is still in flight"). The disabling itself happens synchronously on click
    // (React state, not a network round trip), so no manual gate is needed.
    renderWithApollo(
      <UploadProvider>
        <UploadPage />
      </UploadProvider>,
      { mocks: [acceptAllMock('GID-1', () => {}, 20)] }
    );
    await act(async () => {
      await Promise.resolve();
    });

    const fileInput = document.getElementById('upload-file-input') as HTMLInputElement;
    const file = new File(['x'.repeat(1000)], 'p1.epub');
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(fileInput);
    });

    xhrInstances[0].status = 200;
    xhrInstances[0].responseText = JSON.stringify({
      results: [
        { filename: 'p1.epub', bookId: 'book-1', globalId: 'GID-1', applied: [], proposals: [fix] },
      ],
    });
    await act(async () => {
      xhrInstances[0].onload?.(new Event('load'));
      await Promise.resolve();
    });

    // The per-upload Accept/Reject start out enabled.
    expect(screen.getByRole('button', { name: /^accept$/i })).not.toHaveAttribute('aria-disabled');

    await act(async () => {
      fireEvent.click(screen.getByText('Actions'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^accept all$/i }));
      await Promise.resolve();
    });

    // While the (delayed) apply is in flight, the card's own Accept/Reject
    // lock. Both checked inside the SAME `waitFor` callback — a second,
    // separately-scheduled assertion could observe the mutation's `delay`
    // having already elapsed between the two checks under a slow/loaded
    // test run, since `waitFor` itself yields to the event loop while
    // polling.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^accept$/i })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
      expect(screen.getByRole('button', { name: /^reject$/i })).toHaveAttribute(
        'aria-disabled',
        'true'
      );
    });

    // Once the mutation resolves, the bulk apply completes and the guard
    // lifts — the card's own Accept/Reject re-enable. (This harness has no
    // resolved library id, so the pending-fix read never actively watches the
    // mutation's cache write; the proposal itself staying listed — rather
    // than disappearing — is a harness artifact, not what this test is
    // about. `dismissFix`/`applyFix` mock-driven end-to-end resolution is
    // covered by `use-upload-queue.test.tsx`'s own merge tests.)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^accept$/i })).not.toHaveAttribute('aria-disabled')
    );
  });
});
