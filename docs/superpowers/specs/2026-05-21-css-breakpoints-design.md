# CSS Breakpoints Design

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Introduce a two-tier breakpoint system (Mobile / Normal) to the app. Breakpoints are defined once in the theme object so all JSS component styles can reference them via `theme.breakpoint.*`. The first consumer is the header, which becomes non-sticky on mobile.

## Breakpoint Values

| Name     | Condition              | Value         |
|----------|------------------------|---------------|
| `mobile` | `max-width: 640px`     | phones, narrow viewports |
| `normal` | `min-width: 641px`     | tablets, desktops        |

The boundary is 640px. `normal` starts at 641px to avoid a 1px overlap at exactly 640px.

## Theme Changes

**File:** `client/src/provider/theme/theme.ts`

Add `breakpoint` to the `Theme` interface:

```ts
breakpoint: {
  mobile: string;
  normal: string;
}
```

Add to `buildTheme()`:

```ts
const breakpoint: Theme['breakpoint'] = {
  mobile: '@media (max-width: 640px)',
  normal: '@media (min-width: 641px)',
};
```

Include `breakpoint` in the returned theme object.

## Usage Pattern

Breakpoints are used as JSS computed property keys:

```ts
root: {
  position: 'sticky',
  [theme.breakpoint.mobile]: {
    position: 'relative',
  },
},
```

This is idiomatic JSS — no new import pattern required.

## First Consumer: Header Stickiness

**File:** `client/src/component/header/style.ts`

The header `root` class has `position: 'sticky'` unconditionally. Add a mobile override:

```ts
root: {
  // ... existing styles unchanged ...
  [theme.breakpoint.mobile]: {
    position: 'relative',
  },
},
```

On mobile (≤640px) the header scrolls with the page. On normal (≥641px) it remains sticky at the top.

## Scope

This change introduces the breakpoint infrastructure and applies it to the header only. All other components remain unchanged and will adopt breakpoints in separate changes as needed.
