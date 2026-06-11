# Toast Provider Design

**Date:** 2026-06-10
**Branch:** refactor/set-state-in-effect (will be implemented on a new branch)

## Background

The current toast pattern duplicates `submitCount` / `dismissedCount` state across 9 components. Each call site manages its own counter pair, a derived `toast` IIFE, and a `<Toast />` in its render output. This is boilerplate that belongs in a shared abstraction.

## Goal

Replace all 9 call sites with a `useToast` hook backed by a `ToastProvider`. Consumers call `showToast(message, type)` as a fire-and-forget side effect in their event handlers — no local state management required.

## Architecture

### New provider: `provider/toast/`

```
provider/toast/
  context.ts          — context type + createContext default
  provider.tsx        — state (useReducer), renders children + toast stack
  hook/
    index.ts          — barrel
    use-toast.ts      — consumes context, returns showToast
  index.ts            — public barrel: { ToastProvider, useToast }
```

`ToastProvider` is added to `App.tsx`'s `buildProvidersTree`. Position in the tree is arbitrary — toast state has no dependency on auth, book, or other providers.

### `Toast` component

Moves from `component/toast/` to an internal implementation detail inside `provider/toast/`. It is removed from `component/index.ts` exports — no consumer references it directly after migration.

## API

```ts
// In any descendant component:
const showToast = useToast();
showToast('Progress cleared', 'success');
showToast('Failed to reset password', 'error');
```

`ToastProvider` accepts one optional prop:

```ts
<ToastProvider maxToasts={3}>   {/* default: 3 */}
  {children}
</ToastProvider>
```

## State Model

Each entry in the queue:

```ts
type ToastEntry = {
  id: number;           // from a useRef counter — stable, no crypto.randomUUID needed
  message: string;
  type: 'success' | 'error';
  isDismissing: boolean;
};
```

### Reducer actions

| Action | Behaviour |
|--------|-----------|
| `add` | If `queue.length >= maxToasts`, mark `queue[0].isDismissing = true` (triggers slide-out on the oldest). Append new entry. Queue may briefly hold `maxToasts + 1` items while the bumped toast animates out. |
| `dismiss` | Set `isDismissing: true` on the entry with the given id. |
| `remove` | Remove the entry with the given id. |

The auto-dismiss timer (inside `Toast`) fires `dismiss`, not `remove`. `remove` is only dispatched after the exit animation ends via `onAnimationEnd`.

## Rendering

The provider renders a single `position: fixed` container in the bottom-right corner:

```
flex-direction: column
gap: theme.space.md
bottom: theme.space.xxxxl
right: theme.space.xxxxl
zIndex: theme.zIndex.toast
```

Individual `Toast` elements inside the container are plain block elements — they no longer carry their own `position: fixed`. The container handles positioning; `Toast` handles only content and animation.

## Animations

Two keyframes, both defined in the global theme stylesheet:

- **`theme-slide-in`** — existing: slides in from the right, fades in over `transition.slide` (`0.2s ease-out`)
- **`theme-slide-out`** — new (mirror): slides out to the right, fades out over `transition.slide`

`Toast` applies `theme-slide-in` by default. When `isDismissing` is true it switches to `theme-slide-out` and calls `onRemove` on `animationend`.

## Migration: call site changes

All 9 call sites:

1. Remove `submitCount` / `dismissedCount` / `scanCount` / `regenerateCount` / `resetCount` state
2. Remove `handleDismiss` / `handleToastDismiss` callbacks
3. Remove derived `toast` IIFE
4. Remove `<Toast />` from render output
5. Remove `Toast` import
6. Add `const showToast = useToast()` 
7. Call `showToast(message, type)` in the relevant event handler

### Files affected

**Components:**
- `component/library-scan/index.tsx`
- `component/my-progress-row/index.tsx`
- `component/sync-password/index.tsx`
- `component/user-change-password/index.tsx`
- `component/user-progress-row/index.tsx`
- `component/user-register/index.tsx`

**Controls:**
- `control/reset-password-button/index.tsx`

**Pages (also drop local error string state):**
- `page/book-edit/index.tsx`
- `page/login/index.tsx`

### `component/index.ts`

Remove `export { Toast } from './toast'`.

### `App.tsx`

Add `ToastProvider` to `buildProvidersTree`.

## Testing

Existing tests for `my-progress-row`, `user-progress-row`, and `reset-password-button` assert that toast messages appear after actions. These tests will need updating: they currently render the component standalone; after migration, they must wrap the component in `ToastProvider` and query toasts from the rendered output.

No new unit tests are required for the provider itself — the behaviour (show, auto-dismiss, stack cap, slide-out) is straightforward UI state that is better verified visually or via the existing integration-style component tests.
