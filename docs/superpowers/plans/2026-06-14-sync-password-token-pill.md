# SyncPassword Token Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat gray password display in `SyncPassword` with a token-pill design — dashed border, white fill, Tabler key icon on the left, Copy button inside, green checkmark on copied.

**Architecture:** Two isolated changes: (1) add a `KeyIcon` SVG component to the icon library, (2) update `style.ts` and `index.tsx` together (they're coupled — splitting them creates an intermediate TS error state).

**Tech Stack:** React, JSS via `createUseStyles`, Vitest + React Testing Library, ESLint

---

### Task 1: Add `KeyIcon`

**Files:**
- Create: `app/client/src/icon/key.tsx`
- Create: `app/client/src/icon/key.test.tsx`
- Modify: `app/client/src/icon/index.ts`

- [ ] **Step 1: Write the failing test**

Create `app/client/src/icon/key.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KeyIcon } from './key';

describe('KeyIcon', () => {
  it('renders an svg element', () => {
    const { container } = render(<KeyIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies className prop', () => {
    const { container } = render(<KeyIcon className="my-icon" />);
    expect(container.querySelector('svg')?.className).toBe('my-icon');
  });

  it('defaults to 24x24', () => {
    const { container } = render(<KeyIcon />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('accepts custom width and height', () => {
    const { container } = render(<KeyIcon width={14} height={14} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('height')).toBe('14');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app/client && npm test -- key.test
```

Expected: FAIL — `KeyIcon` not found.

- [ ] **Step 3: Create `app/client/src/icon/key.tsx`**

```tsx
import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=key
export const KeyIcon = (props: IconProps) => {
  const {
    'aria-label': ariaLabel,
    className,
    fill,
    height,
    role,
    stroke,
    strokeWidth,
    width,
  } = { ...defaultStrokeIconProps, ...props };

  return (
    <svg
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0" />
      <path d="M15 9h.01" />
    </svg>
  );
};
```

- [ ] **Step 4: Register in `app/client/src/icon/index.ts`**

Replace the file with (adds `KeyIcon` in alphabetical order):

```ts
export { AlertOctagonIcon } from './alert-octagon';
export { BookIcon } from './book';
export { BooksIcon } from './books';
export { CheckIcon } from './check';
export { ChevronCircleIcon } from './chevron-circle';
export { ChevronIcon } from './chevron';
export { CircleXIcon } from './circle-x';
export { ClockIcon } from './clock';
export { KeyIcon } from './key';
export { ListCheckIcon } from './list-check';
export { RowRemoveIcon } from './row-remove';
export { SpinnerIcon } from './spinner';
export { UploadIcon } from './upload';
export { UserIcon } from './user';
export { UsersIcon } from './users';
export { XIcon } from './x';

export type { IconProps } from './props';
```

- [ ] **Step 5: Run tests and lint**

```bash
cd app/client && npm test -- key.test && npm run lint
```

Expected: all 4 tests PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/icon/key.tsx app/client/src/icon/key.test.tsx app/client/src/icon/index.ts
git commit -m "feat: add KeyIcon (Tabler outline key)"
```

---

### Task 2: Restyle the password display area

**Files:**
- Modify: `app/client/src/component/sync-password/style.ts`
- Modify: `app/client/src/component/sync-password/index.tsx`

These two files are updated together — `style.ts` removes the `row` class that `index.tsx` currently uses, so splitting them would leave an intermediate TS error.

- [ ] **Step 1: Replace `app/client/src/component/sync-password/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    border: `1.5px dashed ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    padding: `${theme.space.xl} ${theme.space.xxl}`,
    backgroundColor: theme.color.bg.input,
  },
  pillIcon: {
    flexShrink: 0,
    color: theme.color.text.faint,
  },
  password: {
    fontFamily: theme.fontFamily.mono,
    flex: 1,
    color: theme.color.text.primary,
    fontSize: theme.fontSize.md,
    letterSpacing: '0.03em',
  },
  copiedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
    padding: `4px 10px`,
    border: `1px solid #bbf7d0`,
    borderRadius: theme.radius.md,
    backgroundColor: '#f0fdf4',
    color: theme.color.success,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    whiteSpace: 'nowrap',
  },
}));
```

- [ ] **Step 2: Replace `app/client/src/component/sync-password/index.tsx`**

```tsx
import { Fragment, useCallback, useState } from 'react';

import { Card } from '~/component';
import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon, CheckIcon, KeyIcon } from '~/icon';
import { useToast } from '~/provider/toast';
import { useRegenerateSyncPassword, useSyncPassword } from '~/provider/user';

import { useStyle } from './style';

export const SyncPassword = () => {
  const styles = useStyle();
  const [syncPassword, loadingFetch, fetchError] = useSyncPassword();
  const [regenerate, regenerating, newPassword] = useRegenerateSyncPassword();
  const showToast = useToast();

  const displayPassword = newPassword ?? syncPassword;

  const [showConfirm, setShowConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!displayPassword) return;
    await navigator.clipboard.writeText(displayPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayPassword]);

  const handleRegenerateClick = useCallback(() => setShowConfirm(true), []);
  const handleCancel = useCallback(() => setShowConfirm(false), []);
  const handleConfirm = useCallback(async () => {
    const ok = await regenerate();
    if (ok) {
      showToast('Sync password regenerated', 'success');
    } else {
      showToast('Failed to regenerate sync password', 'error');
    }
    setShowConfirm(false);
  }, [regenerate, showToast]);

  const regenerateElement = [
    <Button
      type="link"
      danger
      loading={regenerating}
      disabled={loadingFetch}
      onClick={handleRegenerateClick}
    >
      Regenerate
    </Button>,
  ];

  return (
    <Fragment>
      <Card title="Sync password" headerAction={regenerateElement}>
        {fetchError && <div>Failed to load sync password.</div>}
        {!fetchError && (
          <div className={styles.pill}>
            <KeyIcon className={styles.pillIcon} width={14} height={14} />
            <span className={styles.password}>{loadingFetch ? '…' : (displayPassword ?? '—')}</span>
            {copied ? (
              <div className={styles.copiedBadge}>
                <CheckIcon width={12} height={12} />
                Copied!
              </div>
            ) : (
              <Button type="default" disabled={!displayPassword || loadingFetch} onClick={handleCopy}>
                Copy
              </Button>
            )}
          </div>
        )}
      </Card>
      <ConfirmModal
        isOpen={showConfirm}
        icon={AlertOctagonIcon}
        title="Regenerate sync password?"
        confirmText="Regenerate"
        cancelText="Cancel"
        danger
        loading={regenerating}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      >
        This will create a <strong>new random sync password</strong>. All of your KoReader devices
        and OPDS clients will stop syncing until you update them with the new password.
      </ConfirmModal>
    </Fragment>
  );
};
```

- [ ] **Step 3: Run tests and lint**

```bash
cd app/client && npm test && npm run lint
```

Expected: all tests PASS (including the 4 `KeyIcon` tests from Task 1), lint clean.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/component/sync-password/style.ts app/client/src/component/sync-password/index.tsx
git commit -m "feat: redesign sync-password display as token pill"
```
