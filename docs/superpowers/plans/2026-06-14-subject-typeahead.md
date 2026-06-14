# Subject Tag/Chip Typeahead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the subject metadata editor in `BookEditForm` with a chip/tag-style typeahead control populated from all subjects in the user's library via a new `GET /api/subjects` API endpoint.

**Architecture:** A new `getSubjects` method on `BookStore` runs a SQLite `json_each` query to return deduplicated subjects without loading full book rows. A new `useLibrarySubjects` hook fetches this endpoint on mount. A new `SubjectChips` control renders the chip UI and replaces the `FieldList` in `BookEditForm`.

**Tech Stack:** Express + Prisma (`$queryRaw`, SQLite `json_each`), React + JSS (`createUseStyles`), Vitest + React Testing Library (client), Jest + Supertest (server).

---

## File Map

| File | Action |
|------|--------|
| `app/server/services/book-store.ts` | Add `getSubjects(owner)` method |
| `app/server/services/book-store.test.ts` | Add `getSubjects` tests |
| `app/server/routes/ui.ts` | Add `GET /api/subjects` route |
| `app/server/routes/ui.test.ts` | Add route integration tests |
| `app/client/src/provider/book/hook/use-library-subjects.ts` | New hook |
| `app/client/src/provider/book/hook/use-library-subjects.test.ts` | New hook tests |
| `app/client/src/provider/book/hook/index.ts` | Export new hook |
| `app/client/src/provider/book/index.ts` | Re-export new hook |
| `app/client/src/control/subject-chips/style.ts` | New control styles |
| `app/client/src/control/subject-chips/index.tsx` | New control |
| `app/client/src/control/subject-chips/index.test.tsx` | New control tests |
| `app/client/src/control/index.ts` | Export new control |
| `app/client/src/component/book-edit-form/index.tsx` | Wire everything together |

---

## Task 1: `BookStore.getSubjects` + `GET /api/subjects` route

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`

- [ ] **Step 1: Write failing `getSubjects` tests in `book-store.test.ts`**

Add this `describe` block at the end of the file, before the final closing brace if any:

```ts
describe('getSubjects', () => {
  it('returns sorted unique subjects across all books', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), {
      ...FAKE_META,
      subjects: ['Fiction', 'History'],
    });
    await bookStore.addBook(OWNER, 'b2', stage('b2'), {
      ...FAKE_META,
      subjects: ['Fiction', 'Science'],
    });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual(['Fiction', 'History', 'Science']);
  });

  it('returns empty array when no books have subjects', async () => {
    await bookStore.addBook(OWNER, 'b1', stage('b1'), { ...FAKE_META, subjects: [] });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual([]);
  });

  it('only returns subjects belonging to the given owner', async () => {
    const OTHER_ID = 'usr_other00000000000000000';
    await prisma.user.create({ data: { id: OTHER_ID, username: 'bob' } });
    const otherOwner = { userId: OTHER_ID, username: 'bob' };
    const otherDir = path.join(booksRoot, 'bob');
    fs.mkdirSync(otherDir, { recursive: true });
    const bobBook = path.join(otherDir, 'staged-b2.epub');
    fs.writeFileSync(bobBook, 'x');
    await bookStore.addBook(OWNER, 'a1', stage('a1'), {
      ...FAKE_META,
      subjects: ['AliceOnly'],
    });
    await bookStore.addBook(otherOwner, 'b2', bobBook, {
      ...FAKE_META,
      subjects: ['BobOnly'],
    });
    const subjects = await bookStore.getSubjects(OWNER);
    expect(subjects).toEqual(['AliceOnly']);
    expect(subjects).not.toContain('BobOnly');
  });
});
```

- [ ] **Step 2: Run server tests to confirm they fail**

```bash
npm test -w app/server -- --testPathPattern book-store
```

Expected: FAIL — `TypeError: bookStore.getSubjects is not a function`

- [ ] **Step 3: Implement `getSubjects` in `book-store.ts`**

Add this method inside the `BookStore` class, after `getStagingDir()`:

```ts
async getSubjects(owner: Owner): Promise<string[]> {
  const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
    SELECT DISTINCT value
    FROM books, json_each(books.subjects)
    WHERE user_id = ${owner.userId}
    ORDER BY value
  `;
  return rows.map((r) => r.value);
}
```

- [ ] **Step 4: Run `getSubjects` tests to confirm they pass**

```bash
npm test -w app/server -- --testPathPattern book-store
```

Expected: PASS — all `getSubjects` tests green.

- [ ] **Step 5: Write failing route tests in `ui.test.ts`**

Add this `describe` block at the end of the file, before the final closing brace:

```ts
describe('GET /api/subjects', () => {
  it('returns sorted unique subjects for the authenticated user', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 's1', stage('s1'), {
      ...FAKE_META,
      subjects: ['Fiction', 'History'],
    });
    await bookStore.addBook(aliceOwner, 's2', stage('s2'), {
      ...FAKE_META,
      subjects: ['Fiction', 'Science'],
    });
    const res = await request(app).get('/api/subjects').set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual(['Fiction', 'History', 'Science']);
  });

  it('returns empty array when no books have subjects', async () => {
    const token = await loginAlice();
    await bookStore.addBook(aliceOwner, 's1', stage('s1'), { ...FAKE_META, subjects: [] });
    const res = await request(app).get('/api/subjects').set(...bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.subjects).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/subjects');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run route tests to confirm they fail**

```bash
npm test -w app/server -- --testPathPattern routes/ui
```

Expected: FAIL — `GET /api/subjects 404`

- [ ] **Step 7: Add `GET /api/subjects` route in `ui.ts`**

In `app/server/routes/ui.ts`, add this route after the `GET /api/books` route (after line ~435):

```ts
router.get('/api/subjects', requireAuth, async (req: Request, res: Response) => {
  const owner = await resolveOwner(req, res);
  if (!owner) return;
  const subjects = await bookStore.getSubjects(owner);
  res.json({ subjects });
});
```

- [ ] **Step 8: Run all server tests to confirm they pass**

```bash
npm test -w app/server
```

Expected: All tests pass, no failures.

- [ ] **Step 9: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat: add BookStore.getSubjects and GET /api/subjects route"
```

---

## Task 2: `useLibrarySubjects` hook

**Files:**
- Create: `app/client/src/provider/book/hook/use-library-subjects.ts`
- Create: `app/client/src/provider/book/hook/use-library-subjects.test.ts`
- Modify: `app/client/src/provider/book/hook/index.ts`
- Modify: `app/client/src/provider/book/index.ts`

- [ ] **Step 1: Write failing hook tests**

Create `app/client/src/provider/book/hook/use-library-subjects.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLibrarySubjects } from './use-library-subjects';

describe('useLibrarySubjects', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches GET /api/subjects on mount and returns subjects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ subjects: ['Fiction', 'History'] }),
      })
    );
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[0]).toEqual(['Fiction', 'History']));
    expect(fetch).toHaveBeenCalledWith('/api/subjects', expect.anything());
  });

  it('starts with loading true', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useLibrarySubjects());
    expect(result.current[1]).toBe(true);
  });

  it('sets loading false after fetch completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ subjects: [] }),
      })
    );
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[1]).toBe(false));
  });

  it('sets error string on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { result } = renderHook(() => useLibrarySubjects());
    await waitFor(() => expect(result.current[2]).toBe('Failed to fetch subjects'));
  });

  it('returns empty array by default', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useLibrarySubjects());
    expect(result.current[0]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -w app/client -- use-library-subjects
```

Expected: FAIL — `Cannot find module './use-library-subjects'`

- [ ] **Step 3: Implement the hook**

Create `app/client/src/provider/book/hook/use-library-subjects.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../../../lib/api-fetch';
import { useWithTargetUser } from '~/provider/library-target';

export const useLibrarySubjects = (): [string[], boolean, string | undefined] => {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const withTargetUser = useWithTargetUser();

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await apiFetch(withTargetUser('/api/subjects'));
      if (!res.ok) throw new Error('Failed to fetch subjects');
      const data = await (res.json() as Promise<{ subjects: string[] }>);
      setSubjects(data.subjects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [withTargetUser]);

  useEffect(() => {
    void fetchSubjects();
  }, [fetchSubjects]);

  return [subjects, loading, error];
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -w app/client -- use-library-subjects
```

Expected: All 5 tests pass.

- [ ] **Step 5: Export from `hook/index.ts`**

Add to `app/client/src/provider/book/hook/index.ts` (alphabetical order, after `useDeleteBook`):

```ts
export { useLibrarySubjects } from './use-library-subjects';
```

- [ ] **Step 6: Re-export from `provider/book/index.ts`**

In `app/client/src/provider/book/index.ts`, add `useLibrarySubjects` to the named export list:

```ts
export {
  useBook,
  useBookLineage,
  useBookList,
  useBookListItems,
  useDeleteBook,
  useFetchBook,
  useFetchBookList,
  useFetchNextPage,
  useLibrarySubjects,
  usePatchBookMetadata,
  useRegenChapters,
  useScanLibrary,
  useSeriesBookList,
  useSeriesList,
  useStandaloneBookList,
  useUnlinkBookLineage,
  useUploadBookList,
  useUploadQueue,
} from './hook';
```

- [ ] **Step 7: Run full client tests and lint**

```bash
npm test -w app/client && npm run lint -w app/client
```

Expected: All tests pass, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/provider/book/hook/use-library-subjects.ts app/client/src/provider/book/hook/use-library-subjects.test.ts app/client/src/provider/book/hook/index.ts app/client/src/provider/book/index.ts
git commit -m "feat: add useLibrarySubjects hook"
```

---

## Task 3: `SubjectChips` control

**Files:**
- Create: `app/client/src/control/subject-chips/style.ts`
- Create: `app/client/src/control/subject-chips/index.tsx`
- Create: `app/client/src/control/subject-chips/index.test.tsx`
- Modify: `app/client/src/control/index.ts`

- [ ] **Step 1: Write failing chip rendering and removal tests**

Create `app/client/src/control/subject-chips/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { SubjectChips } from './index';

it('renders existing subjects as chips', () => {
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={vi.fn()} />
  );
  expect(screen.getByText('Fiction')).toBeInTheDocument();
  expect(screen.getByText('History')).toBeInTheDocument();
});

it('calls onChange without the removed subject when × is clicked', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('button', { name: 'Remove Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['History']);
});

it('shows filtered suggestions that match typed text (case-insensitive)', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips
      value={[]}
      suggestions={['Fiction', 'History', 'Fantasy']}
      onChange={vi.fn()}
    />
  );
  await user.type(screen.getByRole('textbox'), 'fi');
  expect(screen.getByRole('option', { name: 'Fiction' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'History' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Fantasy' })).toBeInTheDocument();
});

it('excludes already-added subjects from suggestions', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips
      value={['Fiction']}
      suggestions={['Fiction', 'History']}
      onChange={vi.fn()}
    />
  );
  await user.type(screen.getByRole('textbox'), 'fi');
  expect(screen.queryByRole('option', { name: 'Fiction' })).not.toBeInTheDocument();
});

it('calls onChange with new subject when a suggestion is clicked', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction']} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'fi');
  await user.click(screen.getByRole('option', { name: 'Fiction' }));
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('calls onChange with free-form subject on Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={[]} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'Sci-Fi{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Sci-Fi']);
});

it('does not call onChange for a duplicate subject', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={['Fiction']} suggestions={[]} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'Fiction{Enter}');
  expect(onChange).not.toHaveBeenCalled();
});

it('removes the last chip on Backspace when input is empty', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={['Fiction', 'History']} suggestions={[]} onChange={onChange} />
  );
  await user.click(screen.getByRole('textbox'));
  await user.keyboard('{Backspace}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});

it('highlights the first suggestion on ArrowDown', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction', 'History']} onChange={vi.fn()} />
  );
  await user.type(screen.getByRole('textbox'), 'i');
  await user.keyboard('{ArrowDown}');
  const options = screen.getAllByRole('option');
  expect(options[0]).toHaveAttribute('aria-selected', 'true');
  expect(options[1]).toHaveAttribute('aria-selected', 'false');
});

it('selects the highlighted suggestion on Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderWithProviders(
    <SubjectChips value={[]} suggestions={['Fiction', 'History']} onChange={onChange} />
  );
  await user.type(screen.getByRole('textbox'), 'i');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith(['Fiction']);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -w app/client -- subject-chips
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Create `style.ts`**

Create `app/client/src/control/subject-chips/style.ts`:

```ts
import { createUseStyles, Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'relative',
  },
  chipsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.xs,
    padding: theme.space.xs,
    backgroundColor: theme.color.bg.input,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    cursor: 'text',
    minHeight: '2.25rem',
    '&:focus-within': {
      borderColor: theme.color.border.focus,
    },
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.xxs,
    padding: `${theme.space.xxs} ${theme.space.sm}`,
    backgroundColor: theme.color.brand.light,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.primary,
    lineHeight: theme.lineHeight.tight,
  },
  chipRemove: {
    display: 'flex',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: theme.color.text.muted,
    fontSize: theme.fontSize.md,
    lineHeight: 1,
    '&:hover': {
      color: theme.color.danger.default,
    },
  },
  input: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: theme.color.text.primary,
    flexGrow: 1,
    minWidth: '8rem',
    padding: `${theme.space.xxs} ${theme.space.xs}`,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: theme.space.xxs,
    padding: 0,
    listStyle: 'none',
    backgroundColor: theme.color.bg.input,
    border: `1px solid ${theme.color.border.default}`,
    borderRadius: theme.radius.md,
    boxShadow: theme.shadow.hoverLift,
    zIndex: theme.zIndex.sticky,
    maxHeight: '12rem',
    overflowY: 'auto',
  },
  dropdownItem: {
    padding: `${theme.space.md} ${theme.space.xl}`,
    cursor: 'pointer',
    fontSize: theme.fontSize.md,
    color: theme.color.text.primary,
    '&:hover': {
      backgroundColor: theme.color.bg.cardHeader,
    },
    '&$highlighted': {
      backgroundColor: theme.color.brand.light,
    },
  },
  highlighted: {},
}));
```

- [ ] **Step 4: Create `index.tsx` with full implementation**

Create `app/client/src/control/subject-chips/index.tsx`:

```tsx
import cx from 'classnames';
import { useState } from 'react';

import { useStyle } from './style';

type Props = {
  value: string[];
  suggestions: string[];
  onChange: (subjects: string[]) => void;
};

export const SubjectChips = ({ value, suggestions, onChange }: Props) => {
  const style = useStyle();
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const filteredSuggestions = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase())
  );

  const showDropdown = inputValue.length > 0 && filteredSuggestions.length > 0;

  function addSubject(subject: string) {
    const trimmed = subject.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInputValue('');
    setHighlightedIndex(-1);
  }

  function removeSubject(subject: string) {
    onChange(value.filter((s) => s !== subject));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredSuggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const highlighted = filteredSuggestions[highlightedIndex];
      if (highlightedIndex >= 0 && highlighted) {
        e.preventDefault();
        addSubject(highlighted);
      } else if (inputValue.trim()) {
        e.preventDefault();
        addSubject(inputValue);
      }
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      removeSubject(value[value.length - 1]!);
    }
  }

  return (
    <div className={style.root}>
      <div className={style.chipsContainer}>
        {value.map((subject) => (
          <span key={subject} className={style.chip}>
            {subject}
            <button
              type="button"
              className={style.chipRemove}
              aria-label={`Remove ${subject}`}
              onClick={() => removeSubject(subject)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className={style.input}
          type="text"
          value={inputValue}
          placeholder={value.length === 0 ? 'Add subject…' : ''}
          onChange={(e) => {
            setInputValue(e.target.value);
            setHighlightedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showDropdown && (
        <ul className={style.dropdown} role="listbox">
          {filteredSuggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === highlightedIndex}
              className={cx(style.dropdownItem, { [style.highlighted]: i === highlightedIndex })}
              onMouseDown={(e) => {
                e.preventDefault();
                addSubject(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test -w app/client -- subject-chips
```

Expected: All 10 tests pass.

- [ ] **Step 6: Add export to `app/client/src/control/index.ts`**

Add the following line in alphabetical order (after `Switch`):

```ts
export { SubjectChips } from './subject-chips';
```

- [ ] **Step 7: Run full client tests and lint**

```bash
npm test -w app/client && npm run lint -w app/client
```

Expected: All tests pass, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/control/subject-chips/ app/client/src/control/index.ts
git commit -m "feat: add SubjectChips chip-style typeahead control"
```

---

## Task 4: Wire `SubjectChips` into `BookEditForm`

**Files:**
- Modify: `app/client/src/component/book-edit-form/index.tsx`

- [ ] **Step 1: Update the file**

In `app/client/src/component/book-edit-form/index.tsx`, make these changes:

**a) Update the `~/control` import** — add `SubjectChips`, remove nothing (FieldList stays for identifiers):

```ts
import { Button, FieldList, NumberInput, SubjectChips, Switch, TextArea, TextInput } from '~/control';
```

**b) Update the `~/provider/book` import** — add `useLibrarySubjects`:

```ts
import { usePatchBookMetadata, useLibrarySubjects } from '~/provider/book';
```

**c) Remove the `SubjectRow` type** — delete this line:

```ts
type SubjectRow = { _key: string; value: string };
```

**d) Add `useLibrarySubjects` call** after the `usePatchBookMetadata` call:

```ts
const [librarySubjects] = useLibrarySubjects();
```

**e) Change `subjects` state from `SubjectRow[]` to `string[]`** — replace:

```ts
const [subjects, setSubjects] = useState<SubjectRow[]>(() =>
  original.subjects.map((subject) => ({ value: subject, _key: generateUUID() }))
);
```

with:

```ts
const [subjects, setSubjects] = useState<string[]>(original.subjects);
```

**f) Simplify the save logic** — in `handleSave`, replace:

```ts
const newSubjects = subjects.map((r) => r.value).filter(Boolean);
```

with:

```ts
const newSubjects = subjects;
```

**g) Replace the Subjects Card contents** — replace:

```tsx
<Card title="Subjects">
  <FieldList
    addLabel="Add subject"
    columns={[{ type: 'text', key: 'value', placeholder: 'Subject' }]}
    rows={subjects as FieldRow[]}
    onAdd={() => setSubjects((prev) => [...prev, { _key: generateUUID(), value: '' }])}
    onRemove={(key) => setSubjects((prev) => prev.filter((r) => r._key !== key))}
    onChange={(key, field, val) =>
      setSubjects((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: val } : r)))
    }
  />
</Card>
```

with:

```tsx
<Card title="Subjects">
  <SubjectChips
    value={subjects}
    suggestions={librarySubjects}
    onChange={setSubjects}
  />
</Card>
```

- [ ] **Step 2: Run client tests and lint**

```bash
npm test -w app/client && npm run lint -w app/client
```

Expected: All tests pass, no lint errors. (The `generateUUID` import is still used by identifiers.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: All server and client tests pass.

- [ ] **Step 4: Run lint across all workspaces**

```bash
npm run lint
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/component/book-edit-form/index.tsx
git commit -m "feat: replace subject FieldList with SubjectChips typeahead"
```
