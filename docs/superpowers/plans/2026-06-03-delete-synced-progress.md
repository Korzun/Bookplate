# Delete Synced Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Clear" button to each progress row so users can delete their own synced reading progress, and admins can delete any user's reading progress, with a confirm modal and a completion toast.

**Architecture:** Two row-level components (`MyProgressRow` for the user page, `UserProgressRow` for the admin user-list page) each gain the same delete flow: a danger link button, a `ConfirmModal`, and a `Toast`. The delete hooks (`useDeleteMyProgress`, `useDeleteUserProgress`) already exist and are API-ready — only UI wiring is needed.

**Tech Stack:** React, TypeScript, Vitest, `@testing-library/react`, `@testing-library/user-event`, `vi.mock`

---

## File Map

| Action | Path |
|--------|------|
| Modify | `app/client/src/component/my-progress-row/index.tsx` |
| Create | `app/client/src/component/my-progress-row/index.test.tsx` |
| Modify | `app/client/src/component/user-progress-row/index.tsx` |
| Create | `app/client/src/component/user-progress-row/index.test.tsx` |

No style changes — `type="link"` buttons carry their own sizing.

---

## Task 1: MyProgressRow — delete flow

**Files:**
- Modify: `app/client/src/component/my-progress-row/index.tsx`
- Create: `app/client/src/component/my-progress-row/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/component/my-progress-row/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

// vi.mock is hoisted before imports — mocks are in place when ./index loads
vi.mock('~/provider/book');
vi.mock('~/provider/progress');

import { useBook } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { MyProgressRow } from './index';

const mockProgress = { document: 'book-1', percentage: 50, device: 'Kindle', timestamp: 1000 };
const mockBook = { id: 'book-1', title: 'Dune' };

describe('MyProgressRow', () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDelete = vi.fn();
    vi.mocked(useBook).mockReturnValue([mockBook, false]);
    vi.mocked(useMyProgress).mockReturnValue([mockProgress, false, false]);
    vi.mocked(useDeleteMyProgress).mockReturnValue([mockDelete, false, false, undefined]);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders a Clear button when progress is loaded', () => {
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  it('calls deleteMyProgress with bookId when confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(mockDelete).toHaveBeenCalledWith('book-1');
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  it('shows an error toast when delete fails', async () => {
    vi.mocked(useDeleteMyProgress).mockReturnValue([
      mockDelete,
      false,
      true,
      'Failed to clear progress',
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MyProgressRow bookId="book-1" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() =>
      expect(screen.getByText('Failed to clear progress')).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm --prefix app/client test -- src/component/my-progress-row
```

Expected: tests fail — `MyProgressRow` does not yet render a Clear button.

- [ ] **Step 3: Implement the delete flow in MyProgressRow**

Replace the full contents of `app/client/src/component/my-progress-row/index.tsx`:

```tsx
import { Fragment, useCallback, useEffect, useState } from 'react';

import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useBook } from '~/provider/book';
import { useDeleteMyProgress, useMyProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { Toast } from '../toast';
import { ProgressIndicator } from '../progress-indicator';

import { useStyle } from './style';

interface MyProgressRowProps {
  bookId: string;
}

export const MyProgressRow = ({ bookId }: MyProgressRowProps) => {
  const styles = useStyle();

  const [book] = useBook(bookId);
  const [progress, progressLoading, progressError] = useMyProgress(bookId);
  const [deleteMyProgress, deleting, error, errorMessage] = useDeleteMyProgress();

  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [submitCount, setSubmitCount] = useState(0);

  const handleDismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (submitCount === 0) return;
    if (deleting) {
      setToast(null);
      return;
    }
    if (error) {
      setToast({ text: errorMessage ?? 'Failed to clear progress', type: 'error' });
      return;
    }
    setToast({ text: 'Progress cleared', type: 'success' });
  }, [submitCount, deleting, error, errorMessage]);

  const handleClear = useCallback(() => setShowModal(true), []);
  const handleCancel = useCallback(() => setShowModal(false), []);
  const handleConfirm = useCallback(() => {
    setShowModal(false);
    setSubmitCount((c) => c + 1);
    deleteMyProgress(bookId);
  }, [deleteMyProgress, bookId]);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book?.title ?? progress.document;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator value={progress.percentage} size={14} />
        </div>
        <div className={styles.book}>{bookTitle}</div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      <ConfirmModal
        isOpen={showModal}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        icon={AlertOctagonIcon}
        danger
        title="Clear reading progress?"
        confirmText="Clear"
        loading={deleting}
      >
        This will remove your synced reading progress for <strong>{bookTitle}</strong>.
      </ConfirmModal>
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm --prefix app/client test -- src/component/my-progress-row
```

Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/component/my-progress-row/index.tsx \
  app/client/src/component/my-progress-row/index.test.tsx
git -C /workspaces/HASS-ODPS commit -m "feat: add clear progress button to MyProgressRow"
```

---

## Task 2: UserProgressRow — delete flow

**Files:**
- Modify: `app/client/src/component/user-progress-row/index.tsx`
- Create: `app/client/src/component/user-progress-row/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/component/user-progress-row/index.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

// vi.mock is hoisted before imports — mocks are in place when ./index loads
vi.mock('~/provider/book');
vi.mock('~/provider/progress');

import { useBook } from '~/provider/book';
import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
import { UserProgressRow } from './index';

const mockProgress = { document: 'book-1', percentage: 75, device: 'Kobo', timestamp: 2000 };
const mockBook = { id: 'book-1', title: 'Foundation' };

describe('UserProgressRow', () => {
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDelete = vi.fn();
    vi.mocked(useBook).mockReturnValue([mockBook, false]);
    vi.mocked(useUserProgress).mockReturnValue([mockProgress, false, false]);
    vi.mocked(useDeleteUserProgress).mockReturnValue([mockDelete, false, false, undefined]);
  });

  afterEach(() => vi.clearAllMocks());

  it('renders a Clear button when progress is loaded', () => {
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('opens the confirm modal when Clear is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByText(/clear reading progress\?/i)).toBeInTheDocument();
  });

  it('calls deleteUserProgress with bookId when confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(mockDelete).toHaveBeenCalledWith('book-1');
  });

  it('closes the modal when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/clear reading progress\?/i)).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows a success toast after clearing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() => expect(screen.getByText('Progress cleared')).toBeInTheDocument());
  });

  it('shows an error toast when delete fails', async () => {
    vi.mocked(useDeleteUserProgress).mockReturnValue([
      mockDelete,
      false,
      true,
      'Failed to clear progress',
    ]);
    const user = userEvent.setup();
    renderWithProviders(<UserProgressRow bookId="book-1" username="alice" />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await user.click(screen.getByRole('button', { name: /^clear$/i }));
    await waitFor(() =>
      expect(screen.getByText('Failed to clear progress')).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm --prefix app/client test -- src/component/user-progress-row
```

Expected: tests fail — `UserProgressRow` does not yet render a Clear button.

- [ ] **Step 3: Implement the delete flow in UserProgressRow**

Replace the full contents of `app/client/src/component/user-progress-row/index.tsx`:

```tsx
import { Fragment, useCallback, useEffect, useState } from 'react';

import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useBook } from '~/provider/book';
import { useDeleteUserProgress, useUserProgress } from '~/provider/progress';
import { relativeTime } from '~/utils';

import { Toast } from '../toast';
import { ProgressIndicator } from '../progress-indicator';

import { useStyle } from './style';

interface UserProgressRowProps {
  bookId: string;
  username: string;
}

export const UserProgressRow = ({ bookId, username }: UserProgressRowProps) => {
  const styles = useStyle();

  const [book] = useBook(bookId);
  const [progress, progressLoading, progressError] = useUserProgress(username, bookId);
  const [deleteUserProgress, deleting, error, errorMessage] = useDeleteUserProgress(username);

  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [submitCount, setSubmitCount] = useState(0);

  const handleDismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (submitCount === 0) return;
    if (deleting) {
      setToast(null);
      return;
    }
    if (error) {
      setToast({ text: errorMessage ?? 'Failed to clear progress', type: 'error' });
      return;
    }
    setToast({ text: 'Progress cleared', type: 'success' });
  }, [submitCount, deleting, error, errorMessage]);

  const handleClear = useCallback(() => setShowModal(true), []);
  const handleCancel = useCallback(() => setShowModal(false), []);
  const handleConfirm = useCallback(() => {
    setShowModal(false);
    setSubmitCount((c) => c + 1);
    deleteUserProgress(bookId);
  }, [deleteUserProgress, bookId]);

  if (progressLoading) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (progressError) {
    return <div className={styles.error}>Error loading progress</div>;
  }
  if (progress === undefined) {
    return null;
  }

  const bookTitle = book?.title ?? progress.document;

  const metadataList: string[] = [];
  if (progress.device) metadataList.push(progress.device);
  if (progress.timestamp != null) metadataList.push(relativeTime(progress.timestamp));

  return (
    <Fragment>
      <div className={styles.root}>
        <div className={styles.progress}>
          <ProgressIndicator value={progress.percentage} size={14} />
        </div>
        <div className={styles.book}>{bookTitle}</div>
        <div className={styles.metadata}>{metadataList.join(' · ')}</div>
        <Button type="link" danger onClick={handleClear} loading={deleting}>
          Clear
        </Button>
      </div>
      <ConfirmModal
        isOpen={showModal}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        icon={AlertOctagonIcon}
        danger
        title="Clear reading progress?"
        confirmText="Clear"
        loading={deleting}
      >
        This will remove synced reading progress for <strong>{bookTitle}</strong>.
      </ConfirmModal>
      {toast && (
        <Toast key={submitCount} message={toast.text} type={toast.type} onDismiss={handleDismiss} />
      )}
    </Fragment>
  );
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm --prefix app/client test -- src/component/user-progress-row
```

Expected: 6 tests pass, 0 failures.

- [ ] **Step 5: Run the full client test suite**

```bash
npm --prefix app/client test
```

Expected: all tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git -C /workspaces/HASS-ODPS add \
  app/client/src/component/user-progress-row/index.tsx \
  app/client/src/component/user-progress-row/index.test.tsx
git -C /workspaces/HASS-ODPS commit -m "feat: add clear progress button to UserProgressRow"
```
