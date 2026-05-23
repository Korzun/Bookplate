# FieldList Component Design

**Date:** 2026-05-15  
**Scope:** Replace `TextInputList` with a column-descriptor-driven `FieldList` control; update `book-edit` subjects and identifiers to use it.

---

## Problem

`TextInputList` has several issues that make it unsuitable for continued use:

1. **Broken `onChange`** — passes the stale `value` closure variable instead of the new input value.
2. **No remove button** — rows can be added but never removed.
3. **Positional `values: string[]`** — loses field semantics; identifiers need named keys (`scheme`, `value`), not indices.
4. **No per-field labels or placeholders** — can't distinguish columns in multi-field rows.
5. **Hardcoded `TextInput`** — can't accommodate `NumberInput` or future input types.

---

## Solution

Delete `TextInputList` and replace it with `FieldList`: a controlled, column-descriptor-driven list component. Row data uses named fields. Each column declares its type, key, placeholder, and optional validation.

---

## Architecture

### Column Descriptors

```ts
type ColumnDescriptor =
  | { type: 'text';   key: string; placeholder?: string; validate?: (v: string) => boolean }
  | { type: 'number'; key: string; placeholder?: string; validate?: (v: string) => boolean };
```

Adding a new input type in the future means adding a union member here and a case in the renderer — no other changes required.

### Row Type

```ts
type FieldRow = { _key: string } & Record<string, string | number | undefined>;
```

The `_key` is a stable React key (`crypto.randomUUID()`) assigned when a row is created. It is stripped before the data is sent to the API.

### Component Props

```ts
type FieldListProps = {
  addLabel: string;
  columns: ColumnDescriptor[];
  onAdd: () => void;
  onChange: (rowKey: string, fieldKey: string, newValue: string | number | undefined) => void;
  onRemove: (rowKey: string) => void;
  onValidChange?: (fieldName: string, isValid: boolean) => void;
  rows: FieldRow[];
};
```

`onValidChange` field names are `${rowKey}.${fieldKey}` — globally unique across all rows and fields, compatible with the existing `isEditValid: Record<string, boolean>` map in `book-edit`.

---

## Internal Structure

Each row renders as a flex row:
- One input per column (`TextInput` or `NumberInput` based on `type`), each `flex-grow: 1`
- Remove button on the right end of the row

Below all rows, an "Add" dashed button with the `addLabel` text.

Each input receives:
- `name={`${rowKey}.${fieldKey}`}`
- `value={row[col.key]}`
- `placeholder={col.placeholder}`
- `validate={col.validate}` (forwarded directly)
- `onValidChange` (forwarded if provided by the parent)

---

## File Changes

### New

```
client/src/control/field-list/index.tsx   — FieldList component + exported types
client/src/control/field-list/style.ts    — layout styles (same visual as text-input-list)
```

### Deleted

```
client/src/control/text-input-list/index.tsx
client/src/control/text-input-list/style.ts
```

### Modified

```
client/src/control/index.ts              — swap TextInputList for FieldList export
client/src/page/book-edit/index.tsx      — update subjects and identifiers sections
```

---

## book-edit State Changes

State types move from positional arrays to named fields:

```ts
// before
type SubjectRow    = { values: [string];        _key: string };
type IdentifierRow = { values: [string, string]; _key: string };

// after
type SubjectRow    = { _key: string; value: string };
type IdentifierRow = { _key: string; scheme: string; value: string };
```

Named handlers for subjects/identifiers (`handleSubjectAdd`, `handleSubjectUpdate`, etc.) are removed. Inline handlers are passed directly to `FieldList` props — they are one-liners and do not need `useCallback`.

The save handler simplifies to:

```ts
const newSubjects    = subjects.map(r => r.value).filter(Boolean);
const newIdentifiers = identifiers.map(({ _key, ...fields }) => fields);
```

---

## Usage Examples

```tsx
<FieldList
  addLabel="Add subject"
  columns={[{ type: 'text', key: 'value', placeholder: 'Subject' }]}
  rows={subjects}
  onAdd={() => setSubjects(prev => [...prev, { _key: crypto.randomUUID(), value: '' }])}
  onRemove={(key) => setSubjects(prev => prev.filter(r => r._key !== key))}
  onChange={(key, field, val) =>
    setSubjects(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  }
/>

<FieldList
  addLabel="Add identifier"
  columns={[
    { type: 'text', key: 'scheme', placeholder: 'Scheme (e.g. isbn)' },
    { type: 'text', key: 'value',  placeholder: 'Value' },
  ]}
  rows={identifiers}
  onAdd={() => setIdentifiers(prev => [...prev, { _key: crypto.randomUUID(), scheme: '', value: '' }])}
  onRemove={(key) => setIdentifiers(prev => prev.filter(r => r._key !== key))}
  onChange={(key, field, val) =>
    setIdentifiers(prev => prev.map(r => r._key === key ? { ...r, [field]: val } : r))
  }
  onValidChange={handleIsValidChange}
/>
```

---

## Out of Scope

- Column labels (not needed today; can be added to `ColumnDescriptor` later)
- Row reordering
- Min/max row count enforcement
- `TextArea` column type (can be added as a union member when needed)
