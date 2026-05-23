# FieldList Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `TextInputList` with a column-descriptor-driven `FieldList` control, and update `book-edit` to use it for subjects and identifiers.

**Architecture:** `FieldList` is a fully-controlled React component that accepts a `columns: ColumnDescriptor[]` array defining each field's type, key, and placeholder. Rows are plain objects with named fields and a `_key` for React identity. The component renders `TextInput` or `NumberInput` per column, forwarding validation callbacks upward.

**Tech Stack:** React, TypeScript, JSS via `createUseStyles`, Vitest + `@testing-library/react` + `@testing-library/user-event`

---

### Task 1: Create `field-list/style.ts`

**Files:**
- Create: `client/src/control/field-list/style.ts`

- [ ] **Step 1: Create the style file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((_theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  rowContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  field: {
    flexGrow: 1,
  },
}));
```

- [ ] **Step 2: Commit**

```bash
git add client/src/control/field-list/style.ts
git commit -m "feat: add field-list style"
```

---

### Task 2: Write failing tests for `FieldList`

**Files:**
- Create: `client/src/control/field-list/index.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '~/test-utils';

import { FieldList, type FieldRow } from './index';

const singleTextColumn = [{ type: 'text' as const, key: 'value', placeholder: 'Subject' }];

it('renders the add button with addLabel', () => {
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={[]}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Add subject' })).toBeInTheDocument();
});

it('calls onAdd when the add button is clicked', async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={[]}
      onAdd={onAdd}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Add subject' }));
  expect(onAdd).toHaveBeenCalledOnce();
});

it('renders an input for each row', () => {
  const rows: FieldRow[] = [
    { _key: 'key-1', value: 'fiction' },
    { _key: 'key-2', value: 'thriller' },
  ];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByDisplayValue('fiction')).toBeInTheDocument();
  expect(screen.getByDisplayValue('thriller')).toBeInTheDocument();
});

it('calls onRemove with the row key when the remove button is clicked', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  const rows: FieldRow[] = [{ _key: 'key-abc', value: 'fiction' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={onRemove}
      onChange={vi.fn()}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Remove row' }));
  expect(onRemove).toHaveBeenCalledWith('key-abc');
});

it('calls onChange with rowKey, fieldKey, and new value when typing', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const rows: FieldRow[] = [{ _key: 'key-1', value: '' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={singleTextColumn}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={onChange}
    />
  );
  await user.type(screen.getByPlaceholderText('Subject'), 'a');
  expect(onChange).toHaveBeenCalledWith('key-1', 'value', 'a');
});

it('renders two inputs per row for a two-column config', () => {
  const twoColumns = [
    { type: 'text' as const, key: 'scheme', placeholder: 'Scheme' },
    { type: 'text' as const, key: 'value', placeholder: 'Value' },
  ];
  const rows: FieldRow[] = [{ _key: 'key-1', scheme: 'isbn', value: '978-0' }];
  renderWithProviders(
    <FieldList
      addLabel="Add identifier"
      columns={twoColumns}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByDisplayValue('isbn')).toBeInTheDocument();
  expect(screen.getByDisplayValue('978-0')).toBeInTheDocument();
});

it('forwards onValidChange when validate returns false', async () => {
  const user = userEvent.setup();
  const onValidChange = vi.fn();
  const columns = [
    {
      type: 'text' as const,
      key: 'value',
      placeholder: 'Subject',
      validate: (v: string) => v.length > 0,
    },
  ];
  const rows: FieldRow[] = [{ _key: 'key-1', value: 'hello' }];
  renderWithProviders(
    <FieldList
      addLabel="Add subject"
      columns={columns}
      rows={rows}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onChange={vi.fn()}
      onValidChange={onValidChange}
    />
  );
  await user.clear(screen.getByDisplayValue('hello'));
  expect(onValidChange).toHaveBeenCalledWith('key-1.value', false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd client && npm test -- field-list
```

Expected: All 7 tests FAIL with "Cannot find module './index'" or similar.

---

### Task 3: Implement `FieldList` and make tests pass

**Files:**
- Create: `client/src/control/field-list/index.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Button } from '../button';
import { NumberInput } from '../number-input';
import { RowRemoveIcon } from '~/icon';
import { TextInput } from '../text-input';

import { useStyle } from './style';

export type ColumnDescriptor =
  | { type: 'text'; key: string; placeholder?: string; validate?: (v: string) => boolean }
  | { type: 'number'; key: string; placeholder?: string; validate?: (v: string) => boolean };

export type FieldRow = { _key: string } & Record<string, string | number | undefined>;

type FieldListProps = {
  addLabel: string;
  columns: ColumnDescriptor[];
  onAdd: () => void;
  onChange: (rowKey: string, fieldKey: string, newValue: string | number | undefined) => void;
  onRemove: (rowKey: string) => void;
  onValidChange?: (fieldName: string, isValid: boolean) => void;
  rows: FieldRow[];
};

export const FieldList = ({
  addLabel,
  columns,
  onAdd,
  onChange,
  onRemove,
  onValidChange,
  rows,
}: FieldListProps) => {
  const style = useStyle();

  return (
    <div className={style.root}>
      <div className={style.rowContainer}>
        {rows.map((row) => (
          <div className={style.row} key={row._key}>
            {columns.map((col) => (
              <div className={style.field} key={col.key}>
                {col.type === 'text' ? (
                  <TextInput
                    name={`${row._key}.${col.key}`}
                    placeholder={col.placeholder}
                    validate={col.validate}
                    value={row[col.key] !== undefined ? String(row[col.key]) : ''}
                    onChange={(newValue) => onChange(row._key, col.key, newValue)}
                    onValidChange={onValidChange}
                  />
                ) : (
                  <NumberInput
                    label={undefined}
                    name={`${row._key}.${col.key}`}
                    placeholder={col.placeholder}
                    validate={col.validate}
                    value={typeof row[col.key] === 'number' ? (row[col.key] as number) : undefined}
                    onChange={(newValue) => onChange(row._key, col.key, newValue)}
                    onValidChange={onValidChange}
                  />
                )}
              </div>
            ))}
            <Button
              type="link"
              danger
              title="Remove row"
              onClick={() => onRemove(row._key)}
            >
              <RowRemoveIcon height={20} width={20} strokeWidth={2} />
            </Button>
          </div>
        ))}
      </div>
      <Button type="dashed" onClick={onAdd}>
        {addLabel}
      </Button>
    </div>
  );
};
```

- [ ] **Step 2: Run the tests to verify they all pass**

```bash
cd client && npm test -- field-list
```

Expected: All 7 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/control/field-list/index.tsx client/src/control/field-list/index.test.tsx
git commit -m "feat: add FieldList component with column descriptor API"
```

---

### Task 4: Update `control/index.ts` to export `FieldList`

**Files:**
- Modify: `client/src/control/index.ts`

- [ ] **Step 1: Replace the `TextInputList` export with `FieldList`**

In `client/src/control/index.ts`, replace:
```ts
export { TextInputList } from './text-input-list';
```
with:
```ts
export { FieldList } from './field-list';
export type { ColumnDescriptor, FieldRow } from './field-list';
```

- [ ] **Step 2: Commit**

```bash
git add client/src/control/index.ts
git commit -m "feat: export FieldList from control index"
```

---

### Task 5: Update `book-edit` to use `FieldList`

**Files:**
- Modify: `client/src/page/book-edit/index.tsx`

This task is one cohesive replacement of the subjects/identifiers section. Apply all changes together.

- [ ] **Step 1: Update imports**

Replace:
```ts
import { Button, NumberInput, Switch, TextArea, TextInput, TextInputList } from '~/control';
```
with:
```ts
import { Button, FieldList, NumberInput, Switch, TextArea, TextInput } from '~/control';
import type { FieldRow } from '~/control';
```

- [ ] **Step 2: Replace the row type definitions**

Replace:
```ts
type SubjectRow = { values: [string]; _key: string };
type IdentifierRow = { values: [string, string]; _key: string };
```
with:
```ts
type SubjectRow = { _key: string; value: string };
type IdentifierRow = { _key: string; scheme: string; value: string };
```

- [ ] **Step 3: Replace subjects state and handlers**

Remove all of:
```ts
const [subjects, setSubjects] = useState<SubjectRow[]>([]);
const handleSubjectAdd = useCallback(() => {
  setSubjects((prev) => [...prev, { values: [''], _key: crypto.randomUUID() }]);
}, []);
const handleRemoveSubject = useCallback((removeKey: string) => {
  setSubjects((prev) => prev.filter(({ _key }) => removeKey !== _key));
}, []);
const handleSubjectUpdate = useCallback(
  (subjectKey: string, valueIndex: number, newValue: string) => {
    setSubjects((prev) =>
      prev.map((row) =>
        subjectKey === row._key
          ? {
              ...row,
              values: row.values.map((value, index) =>
                index === valueIndex ? newValue : value
              ) as [string],
            }
          : row
      )
    );
  },
  []
);
```

Replace with:
```ts
const [subjects, setSubjects] = useState<SubjectRow[]>([]);
```

- [ ] **Step 4: Replace identifiers state and handlers**

Remove all of:
```ts
const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([]);
const handleIdentifierAdd = useCallback(() => {
  setIdentifiers((prev) => [...prev, { values: ['', ''], _key: crypto.randomUUID() }]);
}, []);
const handleIdentifierRemove = useCallback((removeKey: string) => {
  setIdentifiers((prev) => prev.filter(({ _key }) => removeKey !== _key));
}, []);
const handleIdentifierChange = useCallback(
  (identifierKey: string, valueIndex: number, newValue: string) => {
    setIdentifiers((prev) =>
      prev.map((row) =>
        identifierKey === row._key
          ? {
              ...row,
              values: row.values.map((value, index) =>
                index === valueIndex ? newValue : value
              ) as [string, string],
            }
          : row
      )
    );
  },
  []
);
```

Replace with:
```ts
const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([]);
```

- [ ] **Step 5: Update the `useEffect` reset block**

Replace:
```ts
setSubjects(
  original.subjects.map((subject) => ({ values: [subject], _key: crypto.randomUUID() }))
);
setIdentifiers(
  original.identifiers.map((identifier) => ({
    values: [identifier.scheme, identifier.value],
    _key: crypto.randomUUID(),
  }))
);
```
with:
```ts
setSubjects(
  original.subjects.map((subject) => ({ value: subject, _key: crypto.randomUUID() }))
);
setIdentifiers(
  original.identifiers.map((identifier) => ({
    scheme: identifier.scheme,
    value: identifier.value,
    _key: crypto.randomUUID(),
  }))
);
```

- [ ] **Step 6: Update `handleSave`**

Replace:
```ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const newIdentifiers = identifiers.map(({ _key: _, ...rest }) => rest);
const newSubjects = subjects.map((subject: SubjectRow) => subject.value.trim()).filter(Boolean);
```
with:
```ts
const newSubjects = subjects.map((r) => r.value).filter(Boolean);
const newIdentifiers = identifiers.map(({ _key, ...fields }) => fields);
```

Also uncomment the identifiers line in the patch object. Replace:
```ts
// identifiers: !areObjectArraysIdentical(newIdentifiers, original.identifiers)
//   ? newIdentifiers
//   : undefined,
```
with:
```ts
identifiers: !areObjectArraysIdentical(newIdentifiers, original.identifiers)
  ? newIdentifiers
  : undefined,
```

- [ ] **Step 7: Replace the Subjects JSX**

Replace:
```tsx
<NewCard title="Subjects">
  <TextInputList
    name="subjects"
    label="Subjects"
    valueList={subjects}
    onRowAdd={handleSubjectAdd}
  />
</NewCard>
```
with:
```tsx
<NewCard title="Subjects">
  <FieldList
    addLabel="Add subject"
    columns={[{ type: 'text', key: 'value', placeholder: 'Subject' }]}
    rows={subjects as FieldRow[]}
    onAdd={() => setSubjects((prev) => [...prev, { _key: crypto.randomUUID(), value: '' }])}
    onRemove={(key) => setSubjects((prev) => prev.filter((r) => r._key !== key))}
    onChange={(key, field, val) =>
      setSubjects((prev) => prev.map((r) => r._key === key ? { ...r, [field]: val } : r))
    }
  />
</NewCard>
```

Also remove the commented-out old subjects JSX block directly below it (the `{/* <NewCard> ... subjects ... */}` block).

- [ ] **Step 8: Replace the Identifiers JSX**

Replace:
```tsx
<NewCard title="Identifiers">
  <TextInputList
    name="identifiers"
    label="Identifiers"
    valueList={identifiers}
    onRowAdd={handleIdentifierAdd}
    onFieldChange={handleIdentifierChange}
  />
</NewCard>
```
with:
```tsx
<NewCard title="Identifiers">
  <FieldList
    addLabel="Add identifier"
    columns={[
      { type: 'text', key: 'scheme', placeholder: 'Scheme (e.g. isbn)' },
      { type: 'text', key: 'value', placeholder: 'Value' },
    ]}
    rows={identifiers as FieldRow[]}
    onAdd={() =>
      setIdentifiers((prev) => [...prev, { _key: crypto.randomUUID(), scheme: '', value: '' }])
    }
    onRemove={(key) => setIdentifiers((prev) => prev.filter((r) => r._key !== key))}
    onChange={(key, field, val) =>
      setIdentifiers((prev) => prev.map((r) => r._key === key ? { ...r, [field]: val } : r))
    }
    onValidChange={handleIsValidChange}
  />
</NewCard>
```

Also remove the commented-out old identifiers JSX block directly below it (the second `{/* <NewCard> ... identifiers ... */}` block).

- [ ] **Step 9: Run lint and tests**

```bash
cd client && npm run lint && npm test
```

Expected: No lint errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add client/src/page/book-edit/index.tsx
git commit -m "feat: use FieldList for subjects and identifiers in book-edit"
```

---

### Task 6: Delete `text-input-list` and final verification

**Files:**
- Delete: `client/src/control/text-input-list/index.tsx`
- Delete: `client/src/control/text-input-list/style.ts`

- [ ] **Step 1: Delete the old component files**

```bash
rm client/src/control/text-input-list/index.tsx
rm client/src/control/text-input-list/style.ts
rmdir client/src/control/text-input-list
```

- [ ] **Step 2: Run lint and tests to confirm nothing is broken**

```bash
cd client && npm run lint && npm test
```

Expected: No errors. If lint reports unused imports or missing modules, fix them before committing.

- [ ] **Step 3: Commit**

```bash
git add -u client/src/control/text-input-list/
git commit -m "chore: delete TextInputList, superseded by FieldList"
```
