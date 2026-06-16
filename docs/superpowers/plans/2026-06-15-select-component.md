# Select Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bespoke combobox-style `<Select>` control that matches the project's JSS design language, with object/string option support, loading/disabled states, and client-side search filtering; wire it into `filter-bar` as the subject filter.

**Architecture:** The trigger is a styled `div` that switches to a `<input>` when open; filtering is derived state on every render; the dropdown is `position: absolute` inside a `triggerWrapper` div so it escapes any `overflow: hidden` on the layout root without a portal. All state (open, query, highlightedIndex) lives in the component; `filteredOptions` is derived.

**Tech Stack:** React 18, TypeScript, JSS via `createUseStyles`, `classnames`, `@testing-library/react` + `userEvent` + Vitest.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/client/src/control/select/style.ts` | Create | All JSS styles — trigger states, dropdown, layout variants |
| `app/client/src/control/select/index.tsx` | Create | Component, exported types, private `normalise` + `highlight` helpers |
| `app/client/src/control/select/index.test.tsx` | Create | Unit tests |
| `app/client/src/control/index.ts` | Modify | Export `Select` and `SelectOption` |
| `app/client/src/provider/book/type.ts` | Modify | Add `subject?: string` to `BookListFilter` |
| `app/client/src/component/filter-bar/index.tsx` | Modify | Add `<Select>` for subject using `useLibrarySubjects` |

---

## Task 1: Style file

**Files:**
- Create: `app/client/src/control/select/style.ts`

- [ ] **Step 1: Create the style file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    borderRadius: theme.radius.md,
    '&$horizontal': {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'start',
      gap: theme.space.md,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.md,
        marginLeft: theme.space.sm,
        minWidth: '6rem',
        textAlign: 'right',
      },
      '& $triggerWrapper': { flexGrow: 1 },
    },
    '&$vertical': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.xs,
        marginLeft: theme.space.md,
      },
    },
    '&$inline': {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: theme.space.md,
    },
  },
  label: { ...theme.recipe.label },
  triggerWrapper: {
    position: 'relative',
  },
  trigger: {
    ...theme.recipe.input,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
    '&:focus, &:focus-within': { borderColor: theme.color.border.focus },
    '&$loading': {
      cursor: 'default',
      borderColor: '#e6e6e6',
      color: theme.color.text.muted,
      '&:hover': { borderColor: '#e6e6e6' },
      '&:focus, &:focus-within': { borderColor: '#e6e6e6' },
    },
    '&$disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
      '&:hover': { borderColor: theme.color.border.default },
      '&:focus, &:focus-within': { borderColor: theme.color.border.default },
    },
  },
  triggerText: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.80rem',
    color: theme.color.text.primary,
    '&$placeholder': { color: theme.color.text.faint },
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: theme.fontFamily.body,
    fontSize: '0.80rem',
    color: theme.color.text.primary,
    flex: 1,
    minWidth: 0,
    padding: 0,
    '&::placeholder': { color: theme.color.text.faint },
  },
  clearButton: {
    display: 'flex',
    alignItems: 'center',
    color: theme.color.text.faint,
    cursor: 'pointer',
    flexShrink: 0,
    '&:hover': { color: theme.color.text.primary },
  },
  chevron: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    color: theme.color.text.faint,
    transform: 'rotate(90deg)',
    transition: `transform ${theme.transition.fast}`,
    '&$open': { transform: 'rotate(-90deg)' },
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: theme.space.xxs,
    zIndex: theme.zIndex.stack.hi,
    border: `1px solid ${theme.color.border.strong}`,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.bg.card,
    boxShadow: theme.shadow.hoverLift,
    overflow: 'hidden',
  },
  optionList: {
    listStyle: 'none',
    margin: 0,
    padding: `${theme.space.xs} 0`,
    maxHeight: '200px',
    overflowY: 'auto',
  },
  option: {
    fontFamily: theme.fontFamily.body,
    fontSize: '0.80rem',
    padding: `${theme.space.md} ${theme.space.xxl}`,
    cursor: 'pointer',
    color: theme.color.text.primary,
    '&:hover': { backgroundColor: theme.color.bg.cardHeader },
    '&$highlighted': { backgroundColor: theme.color.brand.light },
    '&$selected': { fontWeight: theme.fontWeight.semibold },
    '&$emptyOption': {
      color: theme.color.text.faint,
      fontStyle: 'italic',
      cursor: 'default',
      '&:hover': { backgroundColor: 'transparent' },
    },
  },
  matchHighlight: {
    backgroundColor: theme.color.blue[100],
    borderRadius: '2px',
    padding: '0 1px',
  },
  spinner: { ...theme.recipe.spinner },
  // Empty modifier classes — referenced as $name in compound selectors above
  loading: {},
  disabled: {},
  open: {},
  placeholder: {},
  highlighted: {},
  selected: {},
  emptyOption: {},
  // Layout variant classes
  horizontal: {},
  vertical: {},
  inline: {},
}));
```

- [ ] **Step 2: Commit**

```bash
cd app/client
git add src/control/select/style.ts
git commit -m "feat: add Select style file"
```

---

## Task 2: Closed-state rendering

**Files:**
- Create: `app/client/src/control/select/index.test.tsx`
- Create: `app/client/src/control/select/index.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/control/select/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Select } from './index';

const options = ['Fantasy', 'Horror', 'Science Fiction', 'Thriller'];

describe('Select', () => {
  describe('closed state', () => {
    it('shows placeholder when no value selected', () => {
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick a genre…" />
      );
      expect(screen.getByRole('button', { name: 'Pick a genre…' })).toBeInTheDocument();
    });

    it('shows selected label when value is set', () => {
      renderWithProviders(<Select name="genre" options={options} value="Science Fiction" />);
      expect(screen.getByRole('button', { name: 'Science Fiction' })).toBeInTheDocument();
    });

    it('shows clear button when a value is selected', () => {
      renderWithProviders(<Select name="genre" options={options} value="Horror" />);
      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('hides clear button when no value is selected', () => {
      renderWithProviders(<Select name="genre" options={options} value={undefined} />);
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('calls onChange(undefined) when clear is clicked', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value="Horror" onChange={onChange} />
      );
      await user.click(screen.getByRole('button', { name: 'Clear' }));
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('shows label text for object option whose value matches', () => {
      const objOptions = [
        { label: 'Science Fiction', value: 'sci-fi' },
        { label: 'Fantasy', value: 'fantasy' },
      ];
      renderWithProviders(<Select name="genre" options={objOptions} value="sci-fi" />);
      expect(screen.getByRole('button', { name: 'Science Fiction' })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: `Cannot find module './index'`

- [ ] **Step 3: Implement the component (closed state only)**

Create `app/client/src/control/select/index.tsx`:

```tsx
import cx from 'classnames';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronIcon, SpinnerIcon } from '~/icon';

import { useStyle } from './style';

export type SelectOption = string | { label: string; value: string };

export type SelectProps = {
  disabled?: boolean;
  label?: string;
  layout?: 'horizontal' | 'vertical' | 'inline';
  loading?: boolean;
  name: string;
  onChange?: (value: string | undefined) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string | undefined;
};

function normalise(option: SelectOption): { label: string; value: string } {
  return typeof option === 'string' ? { label: option, value: option } : option;
}

function highlight(text: string, query: string, className: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className={className}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export const Select = ({
  disabled = false,
  label,
  layout = 'horizontal',
  loading = false,
  name,
  onChange = () => {},
  options,
  placeholder = 'Select…',
  value,
}: SelectProps) => {
  const style = useStyle();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalisedOptions = options.map(normalise);
  const filteredOptions = normalisedOptions.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase())
  );
  const selectedLabel = normalisedOptions.find((o) => o.value === value)?.label;

  const open = useCallback(() => {
    if (disabled || loading) return;
    setIsOpen(true);
    setHighlightedIndex(0);
  }, [disabled, loading]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setHighlightedIndex(0);
  }, []);

  const select = useCallback(
    (optValue: string) => {
      onChange(optValue);
      close();
    },
    [onChange, close]
  );

  const clear = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [close]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
    [open]
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          filteredOptions.length === 0 ? 0 : (i + 1) % filteredOptions.length
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) =>
          filteredOptions.length === 0 ? 0 : (i - 1 + filteredOptions.length) % filteredOptions.length
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const opt = filteredOptions[highlightedIndex];
        if (opt) select(opt.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        close();
      }
    },
    [filteredOptions, highlightedIndex, select, close]
  );

  return (
    <div ref={rootRef} className={cx(style.root, style[layout])}>
      {label && (
        <label className={style.label} htmlFor={name}>
          {label}
        </label>
      )}
      <div className={style.triggerWrapper}>
        {isOpen ? (
          <div className={style.trigger}>
            <input
              ref={inputRef}
              id={name}
              className={style.searchInput}
              aria-label="Search"
              placeholder="Type to search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
            />
            <span className={cx(style.chevron, style.open)}>
              <ChevronIcon height={12} width={12} />
            </span>
          </div>
        ) : (
          <div
            className={cx(style.trigger, {
              [style.loading]: loading,
              [style.disabled]: disabled,
            })}
            role="button"
            tabIndex={disabled || loading ? -1 : 0}
            aria-label={selectedLabel ?? placeholder}
            onClick={open}
            onKeyDown={handleTriggerKeyDown}
          >
            {loading && <SpinnerIcon className={style.spinner} />}
            <span
              className={cx(style.triggerText, { [style.placeholder]: !selectedLabel })}
            >
              {loading ? 'Loading…' : (selectedLabel ?? placeholder)}
            </span>
            {value && !disabled && !loading && (
              <span
                className={style.clearButton}
                role="button"
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  clear();
                }}
              >
                ✕
              </span>
            )}
            <span className={style.chevron}>
              <ChevronIcon height={12} width={12} />
            </span>
          </div>
        )}
        {isOpen && (
          <div className={style.dropdown}>
            <ul className={style.optionList} role="listbox">
              {filteredOptions.length === 0 ? (
                <li
                  className={cx(style.option, style.emptyOption)}
                  role="option"
                  aria-selected={false}
                >
                  No results
                </li>
              ) : (
                filteredOptions.map((opt, index) => (
                  <li
                    key={opt.value}
                    className={cx(style.option, {
                      [style.highlighted]: index === highlightedIndex,
                      [style.selected]: opt.value === value,
                    })}
                    role="option"
                    aria-selected={opt.value === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(opt.value)}
                  >
                    {highlight(opt.label, query, style.matchHighlight)}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests — verify closed-state tests pass**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd app/client
git add src/control/select/index.tsx src/control/select/index.test.tsx
git commit -m "feat: add Select component — closed state"
```

---

## Task 3: Open state and filtering

**Files:**
- Modify: `app/client/src/control/select/index.test.tsx`

- [ ] **Step 1: Add open/filter/select tests**

Append inside `describe('Select', ...)` after the `closed state` describe block:

```tsx
  describe('open state', () => {
    it('opens dropdown on click', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('shows all options when opened', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('filters options as user types', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.type(screen.getByRole('textbox', { name: 'Search' }), 'sci');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Science Fiction');
    });

    it('shows No results when query matches nothing', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.type(screen.getByRole('textbox', { name: 'Search' }), 'xyz');
      expect(screen.getByRole('option')).toHaveTextContent('No results');
    });

    it('calls onChange with the option value when an option is clicked', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" onChange={onChange} />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[2]); // Science Fiction
      expect(onChange).toHaveBeenCalledWith('Science Fiction');
    });

    it('calls onChange with the object value field when object options used', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const objOptions = [
        { label: 'Science Fiction', value: 'sci-fi' },
        { label: 'Fantasy', value: 'fantasy' },
      ];
      renderWithProviders(
        <Select name="genre" options={objOptions} value={undefined} placeholder="Pick…" onChange={onChange} />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[0]);
      expect(onChange).toHaveBeenCalledWith('sci-fi');
    });

    it('closes after selecting an option', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" onChange={vi.fn()} />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(screen.getAllByRole('option')[0]);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes when clicking outside', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      await user.click(document.body);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests — verify new tests fail, prior tests still pass**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: 6 pass (closed state), 8 fail (open state — `listbox` not found).

The component already has the full open-state implementation from Task 2. If the tests pass without further changes, that is expected — the implementation was written in full in Task 2. Proceed to step 3.

- [ ] **Step 3: Run all open-state tests — verify they all pass**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: 14 tests pass.

- [ ] **Step 4: Commit**

```bash
cd app/client
git add src/control/select/index.test.tsx
git commit -m "test: add Select open-state and filtering tests"
```

---

## Task 4: Keyboard navigation

**Files:**
- Modify: `app/client/src/control/select/index.test.tsx`

- [ ] **Step 1: Add keyboard navigation tests**

Append inside `describe('Select', ...)`:

```tsx
  describe('keyboard navigation', () => {
    it('opens on ArrowDown from the trigger', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('selects the first option on Enter immediately after opening', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" onChange={onChange} />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}'); // open; highlight=0 (Fantasy)
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith('Fantasy');
    });

    it('moves highlight down with ArrowDown and selects on Enter', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" onChange={onChange} />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}'); // open; highlight=0
      await user.keyboard('{ArrowDown}'); // highlight=1 (Horror)
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenCalledWith('Horror');
    });

    it('closes on Escape without calling onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} placeholder="Pick…" onChange={onChange} />
      );
      screen.getByRole('button', { name: 'Pick…' }).focus();
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run tests — verify keyboard tests pass**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: all 18 tests pass. The keyboard handlers are already in the implementation from Task 2.

- [ ] **Step 3: Commit**

```bash
cd app/client
git add src/control/select/index.test.tsx
git commit -m "test: add Select keyboard navigation tests"
```

---

## Task 5: Loading and disabled states

**Files:**
- Modify: `app/client/src/control/select/index.test.tsx`

- [ ] **Step 1: Add loading and disabled tests**

Append inside `describe('Select', ...)`:

```tsx
  describe('loading state', () => {
    it('shows Loading… text when loading', () => {
      renderWithProviders(
        <Select name="genre" options={[]} value={undefined} loading />
      );
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('does not open when loading', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={[]} value={undefined} loading placeholder="Pick…" />
      );
      // tabIndex is -1 when loading, but we can still fire a click on the element
      const trigger = screen.getByText('Loading…').closest('div[role="button"]') as HTMLElement;
      await user.click(trigger);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('does not open when disabled', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <Select name="genre" options={options} value={undefined} disabled placeholder="Pick…" />
      );
      await user.click(screen.getByRole('button', { name: 'Pick…' }));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('hides clear button when disabled even with a value', () => {
      renderWithProviders(
        <Select name="genre" options={options} value="Fantasy" disabled />
      );
      expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests — verify all pass**

```bash
cd app/client
npm test -- --reporter=verbose src/control/select/index.test.tsx
```

Expected: all 22 tests pass.

- [ ] **Step 3: Run lint**

```bash
cd app/client
npm run lint src/control/select/
```

Expected: no errors. Fix any reported before continuing.

- [ ] **Step 4: Commit**

```bash
cd app/client
git add src/control/select/index.test.tsx
git commit -m "test: add Select loading and disabled state tests"
```

---

## Task 6: Export from control index

**Files:**
- Modify: `app/client/src/control/index.ts`

- [ ] **Step 1: Add the export**

In `app/client/src/control/index.ts`, add these two lines in alphabetical position among the existing exports:

```ts
export { Select } from './select';
export type { SelectOption, SelectProps } from './select';
```

The file already exports `Switch` and `TextArea`; `Select` sorts between `ResetPasswordButton` and `SetProgressModal`. Insert accordingly.

- [ ] **Step 2: Run full test suite and lint**

```bash
cd app/client
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

- [ ] **Step 3: Commit**

```bash
cd app/client
git add src/control/index.ts
git commit -m "feat: export Select from control index"
```

---

## Task 7: Add subject to BookListFilter

**Files:**
- Modify: `app/client/src/provider/book/type.ts` (lines 35–38)

- [ ] **Step 1: Add the subject field**

In `app/client/src/provider/book/type.ts`, change:

```ts
export type BookListFilter = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
};
```

to:

```ts
export type BookListFilter = {
  type?: 'standalone' | 'series';
  status?: 'not-started' | 'in-progress' | 'completed';
  subject?: string;
};
```

- [ ] **Step 2: Run full test suite and lint**

```bash
cd app/client
npm test && npm run lint
```

Expected: all tests pass, no lint errors. TypeScript will verify that any existing consumers of `BookListFilter` accept the new optional field without changes.

- [ ] **Step 3: Commit**

```bash
cd app/client
git add src/provider/book/type.ts
git commit -m "feat: add subject field to BookListFilter"
```

---

## Task 8: Wire Select into filter-bar

**Files:**
- Modify: `app/client/src/component/filter-bar/index.tsx`

- [ ] **Step 1: Update the filter-bar component**

Replace the entire contents of `app/client/src/component/filter-bar/index.tsx`:

```tsx
import type { BookListFilter } from '~/provider/book';
import { useLibrarySubjects } from '~/provider/book/hook/use-library-subjects';
import { Select } from '~/control';

import { useStyle } from './style';

interface FilterBarProps {
  filter: BookListFilter;
  onChange: (filter: BookListFilter) => void;
}

export function FilterBar({ filter, onChange }: FilterBarProps) {
  const style = useStyle();
  const [subjects, subjectsLoading] = useLibrarySubjects();

  return (
    <div className={style.root}>
      <select
        aria-label="Filter by book type"
        className={style.select}
        value={filter.type ?? ''}
        onChange={(e) =>
          onChange({
            ...filter,
            type: e.target.value === '' ? undefined : (e.target.value as BookListFilter['type']),
          })
        }
      >
        <option value="">All Types</option>
        <option value="standalone">Standalone</option>
        <option value="series">Series</option>
      </select>
      <select
        aria-label="Filter by reading status"
        className={style.select}
        value={filter.status ?? ''}
        onChange={(e) =>
          onChange({
            ...filter,
            status:
              e.target.value === '' ? undefined : (e.target.value as BookListFilter['status']),
          })
        }
      >
        <option value="">All Statuses</option>
        <option value="not-started">Not Started</option>
        <option value="in-progress">In Progress</option>
        <option value="completed">Completed</option>
      </select>
      <Select
        name="subject"
        layout="inline"
        options={subjects}
        loading={subjectsLoading}
        value={filter.subject}
        placeholder="All Subjects"
        onChange={(subject) => onChange({ ...filter, subject })}
      />
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite and lint**

```bash
cd app/client
npm test && npm run lint
```

Expected: all tests pass, no lint errors.

- [ ] **Step 3: Commit**

```bash
cd app/client
git add src/component/filter-bar/index.tsx
git commit -m "feat: add subject Select to filter-bar"
```

---

## Done

At this point:
- `Select` is fully implemented and tested (22 tests)
- It is exported from `~/control` alongside Button, TextInput, etc.
- `BookListFilter` carries an optional `subject` field
- `FilterBar` uses `<Select>` with live subject data from `useLibrarySubjects`
