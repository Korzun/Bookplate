# TextArea Auto-Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `autoResize` prop to the `TextArea` control that makes the textarea grow and shrink to fit its content, with a 5-row minimum height.

**Architecture:** On every value change, a `useEffect` resets the textarea height to `auto` then sets it to `scrollHeight`, causing the browser to recalculate the natural height. The minimum height is enforced via inline style. The prop is opt-in so existing usages are unaffected.

**Tech Stack:** React (useRef, useEffect), TypeScript, Vitest + @testing-library/react

---

### Task 1: Remove `minHeight` from the stylesheet

The inline style added in Task 2 will own `minHeight`. Removing it from the stylesheet first avoids the stylesheet value overriding the inline value.

**Files:**
- Modify: `client/src/control/text-area/style.ts`

- [ ] **Step 1: Remove `minHeight` from `.input` in the stylesheet**

In `client/src/control/text-area/style.ts`, change the `.input` rule from:

```ts
  input: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'transparent',
    padding: theme.space.md,
    resize: 'none',
    minHeight: '10rem',
    '&$outlined': {
      ...theme.recipe.input,
    },
    '&$borderless': {
      borderStyle: 'none',
      borderRadius: theme.radius.md,
    },
  },
```

to:

```ts
  input: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'transparent',
    padding: theme.space.md,
    resize: 'none',
    '&$outlined': {
      ...theme.recipe.input,
    },
    '&$borderless': {
      borderStyle: 'none',
      borderRadius: theme.radius.md,
    },
  },
```

- [ ] **Step 2: Commit**

```bash
git add client/src/control/text-area/style.ts
git commit -m "style(text-area): move minHeight to inline style"
```

---

### Task 2: Write the failing tests

**Files:**
- Create: `client/src/control/text-area/index.test.tsx`

- [ ] **Step 1: Create the test file**

Create `client/src/control/text-area/index.test.tsx` with the following content:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { TextArea } from './index';

it('renders a textarea element', () => {
  renderWithProviders(<TextArea name="desc" value="hello" />);
  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

it('applies minHeight 10rem when autoResize is not set', () => {
  renderWithProviders(<TextArea name="desc" value="" />);
  const el = screen.getByRole('textbox');
  expect(el).toHaveStyle({ minHeight: '10rem' });
});

it('applies minHeight 7rem when autoResize is true', () => {
  renderWithProviders(<TextArea name="desc" value="" autoResize />);
  const el = screen.getByRole('textbox');
  expect(el).toHaveStyle({ minHeight: '7rem' });
});

it('sets height on the textarea after mount when autoResize is true', () => {
  renderWithProviders(<TextArea name="desc" value="some content" autoResize />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  // jsdom scrollHeight is 0, so height resolves to '0px' — we verify the property was written
  expect(el.style.height).not.toBe('');
});

it('updates height when value changes with autoResize', async () => {
  const user = userEvent.setup();
  renderWithProviders(<TextArea name="desc" value="" autoResize onChange={() => {}} />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  // Mock scrollHeight to return a non-zero value so we can detect change
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 200 });
  await user.type(el, 'a');
  expect(el.style.height).toBe('200px');
});

it('does not set height on the textarea when autoResize is false', () => {
  renderWithProviders(<TextArea name="desc" value="some content" />);
  const el = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(el.style.height).toBe('');
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd client && npm test -- text-area
```

Expected: several tests FAIL because `autoResize` prop doesn't exist yet and `minHeight` is still only in the stylesheet.

---

### Task 3: Implement the `autoResize` prop

**Files:**
- Modify: `client/src/control/text-area/index.tsx`

- [ ] **Step 1: Update the component**

Replace the entire contents of `client/src/control/text-area/index.tsx` with:

```tsx
import cx from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useStyle } from './style';

export type TextAreaProps = {
  autoResize?: boolean;
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  name: string;
  onChange?: (newValue: string | undefined) => void;
  onValidChange?: (fieldName: string, newValid: boolean) => void;
  placeholder?: string;
  validate?: (newValue: string) => boolean;
  value: string | undefined;
  variant?: 'outlined' | 'borderless';
};

export const TextArea = ({
  autoResize = false,
  label,
  layout = 'horizontal',
  name,
  onChange = () => {},
  onValidChange = () => {},
  placeholder,
  validate = () => true,
  value = '',
  variant = 'outlined',
}: TextAreaProps) => {
  const style = useStyle();
  const ref = useRef<HTMLTextAreaElement>(null);

  const [isValid, setIsValid] = useState<boolean>(true);
  const [internalValue, setInternalValue] = useState<string | undefined>(value);
  const [prevValue, setPrevValue] = useState<string | undefined>(value);

  const handleValueChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      setInternalValue(newValue);
      if (validate(newValue)) {
        if (isValid === false) {
          setIsValid(true);
          onValidChange(name, true);
        }
        onChange(newValue === '' ? undefined : newValue);
      } else {
        if (isValid === true) {
          setIsValid(false);
          onValidChange(name, false);
        }
      }
    },
    [isValid, name, onChange, onValidChange, validate]
  );

  if (value !== prevValue) {
    setPrevValue(value);
    setInternalValue(value);
  }

  useEffect(() => {
    if (!autoResize || !ref.current) return;
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [autoResize, internalValue]);

  return (
    <div className={cx(style.root, style[layout])}>
      {label && (
        <label className={cx(style.label, { [`${style.danger}`]: !isValid })}>{label}</label>
      )}
      <textarea
        className={cx(style.input, style[variant])}
        name={name}
        onChange={handleValueChange}
        placeholder={placeholder}
        ref={autoResize ? ref : undefined}
        style={{ minHeight: autoResize ? '7rem' : '10rem' }}
        value={internalValue}
      />
    </div>
  );
};
```

- [ ] **Step 2: Run the tests and confirm they pass**

```bash
cd client && npm test -- text-area
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
cd client && npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/control/text-area/index.tsx client/src/control/text-area/index.test.tsx
git commit -m "feat(text-area): add autoResize prop to expand/contract to content"
```
