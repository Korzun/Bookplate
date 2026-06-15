# SyncPassword display redesign

**Date:** 2026-06-14
**Scope:** `app/client/src/component/sync-password/`

## Goal

Replace the flat gray box that displays the sync password with a token-pill style that signals "here is a value to copy" — consistent with how developer tools (API key displays, etc.) present credential-like values.

## Design decisions

- **Always visible** — the sync password is a convenience token, not a high-security secret. A show/hide toggle adds friction with minimal benefit.
- **Token pill, not input field** — dashed border and white background give the "value to copy" affordance without looking like an editable input.
- **Key icon** — a small SVG icon on the left provides semantic context. No existing key/lock icon exists in the project; one will be added.
- **Copy button inside the pill** — spatially paired with the value so the relationship is obvious.
- **Green copied state** — the button turns green with a checkmark for 2 seconds after copying, replacing the current plain "Copied!" text swap.

## What changes

### New icon: `KeyIcon`

Add `app/client/src/icon/key.tsx` — a simple Lucide-style key SVG (circle + shaft), exported as `KeyIcon` and registered in `app/client/src/icon/index.ts`.

### `style.ts`

Replace the current `row` and `password` styles with:

- **`pill`** — `display: flex`, `alignItems: center`, `gap: theme.space.md`, `border: 1.5px dashed theme.color.border.default`, `borderRadius: theme.radius.md`, `padding: theme.space.xl theme.space.xxl`, `backgroundColor: theme.color.bg.input` (`#fff` — the outer card is already `bg.card`/`#FAFAFA`, so the pill needs the white input background for contrast)
- **`pillIcon`** — `flexShrink: 0`, `color: theme.color.text.faint`, sized at 14×14
- **`password`** (updated) — `fontFamily: theme.fontFamily.mono`, `flex: 1`, `color: theme.color.text.primary`, `fontSize: theme.fontSize.md`, `letterSpacing: '0.03em'`
- **`copiedBadge`** — a new style for the copied confirmation element: `display: flex`, `alignItems: center`, `gap: theme.space.xs`, `padding: 4px 10px`, `border: 1px solid #bbf7d0`, `borderRadius: theme.radius.md`, `backgroundColor: '#f0fdf4'`, `color: theme.color.success`, `fontSize: theme.fontSize.sm`, `fontWeight: theme.fontWeight.semibold`

### `index.tsx`

- Import `KeyIcon` and `CheckIcon`
- Replace the `<div className={styles.row}>` structure with `<div className={styles.pill}>`
- Add `<KeyIcon className={styles.pillIcon} />` as first child
- Move `<Button>` inside the pill
- When `copied` is true, render `<div className={styles.copiedBadge}><CheckIcon />&nbsp;Copied!</div>` instead of the `<Button>` (Button has no `className` prop, so the copied state must be a separate element)

## Out of scope

- Regenerate button placement (stays in card header)
- Password masking / show-hide toggle
- Any changes to the `ConfirmModal`
