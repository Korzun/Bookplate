# Cover Image Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `<input type="file" />` in `BookEditForm`'s "Cover Image" card with a polished `CoverImagePicker` component that shows a thumbnail, filename, and file size — visually matching the row style of `UploadItem`.

**Architecture:** A new self-contained `CoverImagePicker` component owns its `<Card title="Cover Image">` shell, a hidden file input, and an object URL lifecycle for thumbnail display. It is integrated into `BookEditForm` by replacing the existing card block with a single `<CoverImagePicker value={cover} onChange={setCover} />`. `UploadItem` is left untouched.

**Tech Stack:** React 18, TypeScript, JSS via `createUseStyles`, `@testing-library/react` + `@testing-library/user-event` v14, Vitest

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `app/client/src/component/cover-image-picker/style.ts` | Create | JSS styles for the row, thumb slot, labels, and actions |
| `app/client/src/component/cover-image-picker/index.tsx` | Create | Component logic: file input, thumbnail URL lifecycle, idle/selected states |
| `app/client/src/component/cover-image-picker/index.test.tsx` | Create | All unit tests |
| `app/client/src/component/book-edit-form/index.tsx` | Modify | Swap card + input for `<CoverImagePicker>` |

---

## Task 1: Write `style.ts`

**Files:**
- Create: `app/client/src/component/cover-image-picker/style.ts`

- [ ] **Step 1: Create the styles file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  thumbSlot: {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    borderRadius: '4px',
    overflow: 'hidden',
    border: `1px solid ${theme.color.border.default}`,
    background: theme.color.border.light,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholderIcon: {
    color: theme.color.text.faint,
    lineHeight: 0,
    '& svg': {
      width: '15px',
      height: '15px',
    },
  },
  filename: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.color.text.primary,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  noFile: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    flexGrow: 1,
  },
  size: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
  },
  actions: {
    display: 'flex',
    gap: theme.space.sm,
    marginTop: theme.space.xs,
  },
}));
```

---

## Task 2: Write all tests

**Files:**
- Create: `app/client/src/component/cover-image-picker/index.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { CoverImagePicker } from './index';

// jsdom does not implement URL.createObjectURL — stub it for all tests in this file
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn().mockReturnValue('blob:mock-url'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

const FILE = new File(['x'.repeat(1_048_576)], 'cover.jpg', { type: 'image/jpeg' }); // 1 MB

describe('CoverImagePicker — idle (no file selected)', () => {
  it('renders "No image selected"', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('No image selected')).toBeInTheDocument();
  });

  it('renders "Choose image…" button', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Choose image…' })).toBeInTheDocument();
  });

  it('does not render a "Clear" button', () => {
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('clicking "Choose image…" triggers the hidden file input', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<CoverImagePicker value={undefined} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Choose image…' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

describe('CoverImagePicker — selected (file provided)', () => {
  it('renders the filename', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByText('cover.jpg')).toBeInTheDocument();
  });

  it('renders file size in MB', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });

  it('renders "Change…" button instead of "Choose image…"', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Change…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose image…' })).not.toBeInTheDocument();
  });

  it('renders "Clear" button', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('renders a thumbnail img with the object URL', () => {
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:mock-url');
  });

  it('clicking "Clear" calls onChange with undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<CoverImagePicker value={FILE} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('clicking "Change…" triggers the hidden file input', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<CoverImagePicker value={FILE} onChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change…' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});

describe('CoverImagePicker — file input', () => {
  it('calls onChange with the selected file when the input changes', () => {
    const onChange = vi.fn();
    renderWithProviders(<CoverImagePicker value={undefined} onChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([''], 'new.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(onChange).toHaveBeenCalledWith(file);
  });
});
```

- [ ] **Step 2: Run tests and confirm they all fail**

```bash
npx vitest run app/client/src/component/cover-image-picker/index.test.tsx
```

Expected: all tests fail with `Cannot find module './index'` (or similar module-not-found error).

---

## Task 3: Implement `CoverImagePicker`, run tests, commit

**Files:**
- Create: `app/client/src/component/cover-image-picker/index.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';

import { Card } from '~/component/card';
import { Button } from '~/control';
import { UploadIcon } from '~/icon';

import { useStyle } from './style';

interface Props {
  value: File | undefined;
  onChange: (file: File | undefined) => void;
}

export const CoverImagePicker = ({ value, onChange }: Props) => {
  const styles = useStyle();
  const inputRef = useRef<HTMLInputElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!value) {
      setThumbnailUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(value);
    setThumbnailUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.files?.[0] ?? undefined);
    },
    [onChange]
  );

  const handleChoose = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleClear = useCallback(() => {
    onChange(undefined);
    if (inputRef.current) inputRef.current.value = '';
  }, [onChange]);

  const sizeLabel = value ? `${(value.size / 1_048_576).toFixed(1)} MB` : '—';

  return (
    <Card title="Cover Image">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />
      <div className={styles.row}>
        <div className={styles.thumbSlot}>
          {thumbnailUrl ? (
            <img className={styles.thumb} src={thumbnailUrl} alt="" />
          ) : (
            <div className={styles.placeholderIcon}>
              <UploadIcon />
            </div>
          )}
        </div>
        {value ? (
          <div className={styles.filename}>{value.name}</div>
        ) : (
          <div className={styles.noFile}>No image selected</div>
        )}
        <div className={styles.size}>{sizeLabel}</div>
      </div>
      <div className={styles.actions}>
        <Button onClick={handleChoose}>{value ? 'Change…' : 'Choose image…'}</Button>
        {value && <Button onClick={handleClear}>Clear</Button>}
      </div>
    </Card>
  );
};
```

- [ ] **Step 2: Run tests and confirm they all pass**

```bash
npx vitest run app/client/src/component/cover-image-picker/index.test.tsx
```

Expected: 12 tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/component/cover-image-picker/style.ts \
        app/client/src/component/cover-image-picker/index.tsx \
        app/client/src/component/cover-image-picker/index.test.tsx
git commit -m "feat: add CoverImagePicker component"
```

---

## Task 4: Integrate into `BookEditForm`

**Files:**
- Modify: `app/client/src/component/book-edit-form/index.tsx`

- [ ] **Step 1: Replace the cover card in `BookEditForm`**

In `app/client/src/component/book-edit-form/index.tsx`:

Remove the import (if it exists separately) and the `handleCoverChange` callback:
```tsx
// REMOVE this:
const handleCoverChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
  setCover(event.target.files?.[0] ?? undefined);
}, []);
```

Add the import at the top (alongside existing component imports):
```tsx
import { CoverImagePicker } from '~/component/cover-image-picker';
```

Replace the cover card block (lines ~181-183):
```tsx
// REMOVE:
<Card title="Cover Image">
  <input type="file" accept="image/*" onChange={handleCoverChange} />
</Card>

// ADD:
<CoverImagePicker value={cover} onChange={setCover} />
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all 481+ tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/component/book-edit-form/index.tsx
git commit -m "feat: replace cover image input with CoverImagePicker"
```

---

## Task 5: Lint and final verification

**Files:** None created — verification only.

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass.
