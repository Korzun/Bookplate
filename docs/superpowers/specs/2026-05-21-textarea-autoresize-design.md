# TextArea Auto-Resize Design

**Date:** 2026-05-21  
**Status:** Approved

## Summary

Add an `autoResize` prop to the `TextArea` control that causes it to expand and contract vertically to fit its content, with a minimum height of 5 rows so it remains visually distinct from a text input.

## Scope

Single file changes: `client/src/control/text-area/index.tsx` and `client/src/control/text-area/style.ts`.

## Prop API

```tsx
<TextArea autoResize />
```

- `autoResize?: boolean` — opt-in, defaults to `false`
- Existing usages without the prop are unaffected

## Behavior

When `autoResize` is `true`:

1. A `ref` is attached to the `<textarea>` DOM element.
2. A `resizeToContent` function runs after mount (`useEffect`) and on every value change:
   - Sets `element.style.height = 'auto'` to collapse the element and get the true `scrollHeight`
   - Sets `element.style.height = element.scrollHeight + 'px'` to expand to fit content
3. CSS `minHeight` enforces the 5-row floor so the textarea never collapses below that.
4. `resize: 'none'` is retained — manual resize would conflict with the auto-resize logic.

When `autoResize` is `false` (default): behavior is unchanged from current (`minHeight: '10rem'`, no ref logic).

## Style

The `minHeight` is applied as an inline style on the `<textarea>` element rather than modifying the stylesheet, so it can vary by prop:

- `autoResize: true` → `minHeight: '7rem'` (≈5 lines at 1.4rem line-height)
- `autoResize: false` → `minHeight: '10rem'` (existing behavior)

The stylesheet's existing `minHeight: '10rem'` on `.input` is removed; it is replaced by the inline style logic above.

## Implementation Notes

- Use `useRef<HTMLTextAreaElement>(null)` for the ref.
- The resize effect must depend on `internalValue` so it fires on every keystroke and on externally controlled value changes.
- No new dependencies required.

## Files Changed

| File | Change |
|------|--------|
| `client/src/control/text-area/index.tsx` | Add `autoResize` prop, `useRef`, `useEffect` for resize logic |
| `client/src/control/text-area/style.ts` | Remove `minHeight: '10rem'` from `.input` |
