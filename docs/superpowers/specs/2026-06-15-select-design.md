# Select component — design spec

**Date:** 2026-06-15
**Branch:** worktree off `main`

---

## Overview

A bespoke `<Select>` control built as a combobox: the trigger doubles as a search input when open, filtering the option list as the user types. Matches the design language of existing controls (Button, TextInput, NumberInput) via JSS and the project theme.

Initial use: `filter-bar` subject filter. Designed to work anywhere TextInput/NumberInput is used.

---

## API

```tsx
type SelectOption = string | { label: string; value: string };

type SelectProps = {
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
```

- `options` accepts plain strings or `{ label, value }` objects. Internally both are normalised to `{ label, value }` — a plain string becomes `{ label: "foo", value: "foo" }`.
- `onChange` emits the raw `value` string on selection, or `undefined` when the user clears the field.
- `layout` defaults to `"horizontal"`, matching TextInput and NumberInput.
- `name` is used for label–input association (htmlFor/id), consistent with the other controls.

---

## Interaction model

### Closed state

- Shows the selected option's `label`, or `placeholder` (e.g. `"Select subject…"`) if nothing is selected.
- When a value is selected, a clear button (✕) appears to the right of the label. Clicking it calls `onChange(undefined)` and closes any open dropdown.
- A chevron (▾) on the far right indicates it is a select control.
- Click or focus opens the dropdown.

### Open state

- The trigger becomes a text `<input>`. The selected label is replaced by the query field.
- On open, the input is focused automatically. The full option list is shown.
- Typing filters the list case-insensitively against each option's `label`.
- Matched substrings are highlighted in blue within the option rows.
- The currently keyboard-highlighted option gets a blue tint background.
- The previously selected option is shown in bold wherever it appears in the filtered list.
- A "No results" message is shown when the filtered list is empty.

### Selecting an option

- Click or `Enter` on the highlighted option: calls `onChange(value)`, closes the dropdown, clears the query.

### Closing without selecting

- `Escape`: closes dropdown, restores the previous label display, clears query. Value unchanged.
- `Tab` / blur: same as Escape.
- Click outside (`mousedown` on `document`): closes dropdown, clears query. Value unchanged. Uses `mousedown` (not `click`) to fire before the input's blur event.

---

## Keyboard navigation

| Key | Action |
|-----|--------|
| `↓` / `↑` | Move highlight down / up through filtered list. Wraps at ends. |
| `Enter` | Select highlighted option and close. |
| `Esc` | Close, restore display, clear query. |
| `Tab` | Close (blur), no change. |
| Any character | Opens dropdown if closed; appends to query. |

---

## States

| State | Visual |
|-------|--------|
| Empty | Placeholder text, chevron, no clear button. |
| Value selected | Label text, clear (✕) button, chevron. |
| Open — no query | Full list; first item highlighted; selected item bold. |
| Open — filtering | Filtered list; match text highlighted in blue. |
| Open — no results | "No results" message (italic, muted). |
| Loading | Spinner replaces chevron area; "Loading…" placeholder; not interactive. |
| Disabled | 50% opacity; `not-allowed` cursor; no clear button; not interactive. |

---

## Layout variants

Matches the three modes used by TextInput and NumberInput:

- **`horizontal`** (default): label right-aligned at `6rem` min-width; trigger fills remaining space; card-header background wraps both.
- **`vertical`**: label stacked above trigger; trigger fills full width; card-header background.
- **`inline`**: `inline-flex`, no background, fixed trigger width. Sits inline with surrounding text.

---

## Internal structure

### Files

```
src/control/select/
├── index.tsx   ← component, types, private helpers
└── style.ts    ← JSS styles via createUseStyles
```

Exported from `src/control/index.ts`.

### Private helpers (co-located in index.tsx)

**`normalise(option: SelectOption): { label: string; value: string }`**
Converts plain strings to objects. Called once per render when building the derived option list.

**`highlight(text: string, query: string): ReactNode`**
Wraps the matched substring in a `<span>` with the highlight style. Returns plain text when query is empty.

### State

```ts
const [isOpen, setIsOpen] = useState(false);
const [query, setQuery] = useState('');
const [highlightedIndex, setHighlightedIndex] = useState(0);
```

`filteredOptions` is derived (not stored in state): `normalised.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))`.

### Refs

- `rootRef` — attached to the component root; used by the `mousedown` document listener to detect clicks outside.
- `inputRef` — attached to the search input; used to call `.focus()` on open.

### Dropdown positioning

No portal — `position: absolute` relative to the component root. Sufficient for filter-bar and card-form use. Portal can be added later (localized change: `createPortal` + `getBoundingClientRect` on the trigger) if clipping becomes an issue.

---

## Styling

Uses `createUseStyles((theme: Theme) => ...)` via the project's JSS setup. The trigger uses `theme.recipe.input` as its base (matching TextInput). The label uses `theme.recipe.label`. Loading spinner uses `theme.recipe.spinner`. Focus ring uses `theme.recipe.focusRing`.

The dropdown panel uses `theme.shadow.hoverLift` for elevation, `theme.radius.md` for corners, and `theme.color.border.strong` for its border.

---

## Not in scope

- Portal/`document.body` rendering (deferred; low-effort addition when needed)
- Multi-select
- Async/remote option fetching
- Custom option render functions
- Option groups
