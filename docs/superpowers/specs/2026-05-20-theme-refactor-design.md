# Theme Refactor — Design Spec

**Date:** 2026-05-20
**Branch:** feat/react-migration

## Overview

The client's existing `Theme` is barely used: most components style themselves with raw literals (hex colors, px/rem values, hand-coded `transition` strings, inlined `@keyframes`). Where the theme *is* referenced, several of its values don't match what components actually render — for example, `theme.colors.primary` is `#083FBC`, but every button paints `#1777FF`. The theme functions as decorative dead code.

This spec replaces the theme with one derived from the values components currently render, adds the missing primitives (spacing, font-weight, transition, z-index, keyframes), and exposes a small set of recipes (JSS-spreadable style fragments) so the highest-frequency duplication (form inputs, modal frame, card shell, focus ring, spinner, label) collapses into single sources of truth. All 39 `style.ts` files are then migrated to consume the new theme.

## Success Criteria

1. **Components contain little-to-no bespoke styling.** A typical `style.ts` after migration contains theme-token references and per-component layout (flex direction, grid template, widths, negative margins for layering). No hex colors, no font-size literals, no shadow strings, no `@keyframes` blocks in components.
2. **Look-and-feel changes as little as possible.** All values in the new theme are derived from values components render today. The only intentional changes are: (a) collapsing near-identical hex shades (e.g. `#3696fe` vs `#3f96fe`) to one palette slot, (b) removing unused values from the old theme.

## Scope

- **Affects:** the `client/src/provider/theme/` module and every `client/src/**/style.ts` file (39 files: 23 components, 10 controls, 6 pages).
- **Does not affect:** component `index.tsx` files (no logic changes), tests (existing tests are behavioural, not pixel assertions), server code, build config, dependencies.
- **No new shared components.** Recipes are plain JSS objects, not React components.
- **No new runtime dependencies.** Still `react-jss` with `createUseStyles` and `ThemeProvider`.

## Architecture

### Theme module

`client/src/provider/theme/theme.ts` is rewritten. The shape:

```ts
interface Theme {
  color: {
    // Numeric palette ramps — escape hatch for components with deep state matrices
    gray:  { 50, 100, 200, 300, 400, 500, 600, 700, 900 }
    blue:  { 50, 100, 200, 300, 400, 500, 600, 700, 800 }
    red:   { 50, 100, 300, 400, 500, 600, 700 }

    // Semantic aliases — what components reach for first
    text:    { primary, secondary, muted, faint, onPrimary, onDanger }
    bg:      { page, card, cardHeader, input, footer }
    border:  { default, strong, light, focus, hover, danger }
    success: string    // single semantic alias — `#16a34a`
    brand:   { default, hover, active, light, outline, loading, loadingHover, loadingActive }
    accent:  { default, hover }
    danger:  { default, hover, active, light, outline, loading, loadingHover, loadingActive }
    overlay: { backdrop }
  }
  space:      { xxs, xs, sm, md, lg, xl, xxl, xxxl, xxxxl, xxxxxl }
  radius:     { sm, md, lg, circle }
  fontSize:   { xs, sm, md, lg, xl, xxl }
  fontWeight: { medium, semibold, bold, extrabold }
  lineHeight: { tight, body }
  shadow:     { card, cardStack, hoverLift, dangerStack, brandStack }
  transition: { fast, slide, slow }
  zIndex:     { behind, base, stack: { lo, md, hi }, header, sticky, toast }
  // @keyframes are registered globally as `theme-rotation` and `theme-slide-in`
  // (no `keyframes` object on the Theme — components reference them by global name)

  recipe: {
    input:       JssRule    // border + radius + bg + hover/focus/danger pseudo-states
    focusRing:   JssRule    // 2px outline + outline-color transitions
    label:       JssRule    // 600 weight, md fontSize, muted color, danger variant
    spinner:     JssRule    // 1em rotating element
    buttonStack: JssRule    // "raised" 0px 2px 0px <color> shadow pattern

    modal: {
      dialog:    JssRule    // radius, margins, outline-none
      backdrop:  JssRule    // backdrop blur + saturate + overlay color
      header:    JssRule    // semibold xl heading + padding
      footer:    JssRule    // top border + bg + right-aligned buttons
    }
    card: {
      shell:     JssRule    // bg + border + radius + shadow + overflow
      header:    JssRule    // header strip (bg + border-bottom + padding)
    }
  }
}
```

**Why numeric ramps:** components have 4–6 shades per hue (5 blues, 6 reds). Named slots ("light/dark") run out; numeric (50–700) scales.

**Token values** are derived from the audit of all 39 style files. Representative examples (full table in §"Token derivation" below):

- `color.gray.50` = `#FAFAFA` (used 5× — card bg, modal dialog bg, …)
- `color.gray.100` = `#EEEEEE` (7× — card-header bg, modal footer bg, …)
- `color.gray.200` = `#DDDDDD` (4× — card-header border, modal footer border, …)
- `color.gray.300` = `#D9D9D9` (5× — default input border, default button border, …)
- `color.brand.default` = `#1777FF` (5×)
- `color.danger.default` = `#FF4D4F` (10×)
- `space.md` = `0.5rem` (18× — most common spacing unit)
- `space.xxl` = `1rem` (8×)
- `fontSize.md` = `0.875rem` (18×; the body default)
- `fontWeight.semibold` = `600` (26×)
- `radius.md` = `8px` (7×; default border-radius)
- `radius.lg` = `16px` (2× — modal/card)
- `transition.fast` = `0.1s ease-in` (used by button, switch, header)

### Recipes

Each recipe is a plain JSS object spread into a component rule. Recipes only contain primitive-token references — never other recipes (flat composition, no recursion).

**`recipe.input`** — replaces the near-identical input frame in `text-input/style.ts`, `text-area/style.ts`, `number-input/style.ts`. The recipe handles the full default/hover/focus/danger state matrix; components only override per their own layout:

```ts
recipe.input = {
  outlineWidth: '2px',
  outlineStyle: 'solid',
  outlineColor: 'transparent',
  backgroundColor: theme.color.bg.input,
  borderColor: theme.color.border.default,
  borderStyle: 'solid',
  borderWidth: '1px',
  borderRadius: theme.radius.md,
  padding: theme.space.md,
  '&:hover':  { borderColor: theme.color.border.hover },
  '&:focus':  { borderColor: theme.color.border.focus },
  '&$danger': { borderColor: theme.color.border.danger },
}
```

Each consuming component still declares a local `danger: {}` rule (JSS pattern for the `&$danger` reference). The corresponding component `style.ts` becomes:
```ts
input: { ...theme.recipe.input, flexGrow: 1, zIndex: theme.zIndex.base },
danger: {},
```

**`recipe.modal.{dialog,backdrop,header,footer}`** — replaces the modal frame in `confirm-modal/style.ts` and `set-progress-modal/style.ts`.

**`recipe.card.{shell,header}`** — replaces the bordered/shadowed container + header strip in `card/style.ts`, `card-row/style.ts`, `collapsible-section/style.ts`, `user-list/style.ts`.

**`recipe.focusRing`** — replaces the `outline*` cluster (2px / solid / transparent / color-on-focus) in `button/style.ts`, `text-input/style.ts`, `switch/style.ts`.

**`recipe.label`** — replaces the form-field label (`600` weight, `0.875rem`, muted color, danger variant) in `text-input/`, `text-area/`, `number-input/`, `switch/`, `field-list/`.

**`recipe.spinner`** — replaces the `1em × 1em` rotating element + `@keyframes rotation` defined twice (in `button/` and `upload-item/`). The keyframe definition moves to the theme module's global stylesheet (see "Global styles" below); the recipe references `$theme-rotation` instead of a component-local `$rotation`.

**`recipe.buttonStack`** — replaces the `0px 2px 0px <color>` "raised" pseudo-3D shadow pattern used by buttons and cards.

**Recipe-inclusion criterion:** a pattern becomes a recipe when ≥2 components use ≥3 identical declarations in common. Smaller duplications stay inline.

### Global styles

The theme module registers a single global stylesheet for things that need to live in the document, not in a component:

- `@keyframes theme-rotation`
- `@keyframes theme-slide-in`
- the `body { font-family, background, color, min-height }` that currently lives in `page/style.ts` (moved out of `page/style.ts` into the theme module so it's not coupled to whether a `Page` component is mounted)

Implementation: a new hook `useThemeGlobalStyles()` invoked once inside `ThemeProvider` (or a `<GlobalStyles />` child), defined with `createUseStyles({ '@global': ... })`.

### Provider

`client/src/provider/theme/provider.tsx` mounts `useThemeGlobalStyles()` and wraps children in `JssThemeProvider theme={defaultTheme}`. Existing API (`<ThemeProvider>{children}</ThemeProvider>`) unchanged. Existing `useTheme()` unchanged.

### `applyTransparency` utility

`client/src/utils.ts` exports `applyTransparency(hex, alpha)`. After migration, components mostly stop calling it directly because the common results are pre-computed into tokens (`color.overlay.backdrop`, `shadow.buttonStack`, etc.). It stays in `utils.ts` for cases where opacity is genuinely dynamic — `cover-stack/style.ts` computes per-card opacity by depth.

## Component-migration rules

For every `style.ts`, apply in order:

1. Replace every **color literal** with `theme.color.X`.
2. Replace every **`padding`/`margin`/`gap`** literal with `theme.space.X`.
3. Replace every **`borderRadius`** literal with `theme.radius.X`.
4. Replace every **`fontSize`** literal with `theme.fontSize.X`.
5. Replace every **`fontWeight`** literal with `theme.fontWeight.X`.
6. Replace every **`boxShadow`** literal with `theme.shadow.X`.
7. Replace every **`transition*`** literal with `theme.transition.X` (or its expanded form when JSS needs the long-form properties).
8. Replace every **`zIndex`** literal with `theme.zIndex.X`.
9. Remove inlined **`@keyframes`** definitions; for the spinner use `recipe.spinner`; for the toast slide-in reference the global `theme-slide-in` keyframe directly with `theme.transition.slide`.
10. Where the file matches a recipe (input, modal, card shell, label, spinner, focus ring), spread the recipe and remove the duplicated declarations.
11. Drop unused `applyTransparency` imports.

### What stays bespoke (intentionally)

- **Layout values that don't generalize.** Examples:
  - `cover-stack`: `marginLeft: '-12px'`, `marginLeft: '-15px'` (negative margins for overlap layout)
  - `header`: `width: '15px'`, `height: '15px'` (icon sizing)
  - `proportional-chapter-slider`: `borderRadius: '2px'` / `'1px'` (tick-mark geometry), `width: '4px'` (thumb)
  - `user-row-content`: `left: '1.5px'`, `top: '4.5px'` (sub-pixel optical centering)
  - `metadata-list`: `gap: '12px'` (specific design value not on the spacing scale)

  These remain as literals with a one-line comment explaining the intent.

- **Button state matrix.** `button/style.ts` keeps its 5 `[ButtonType.X]` blocks and the hover/focus/active/loading/disabled/danger selector tree. Only *values* become theme references; the *structure* stays. (Putting button state colors into the theme would inflate the palette by ~30 slots that no other component uses.)

## Phases

Each phase is a separate commit on the existing `feat/react-migration` branch.

### Phase 1 — Build new theme

Files written/edited:
- `client/src/provider/theme/theme.ts` — full rewrite (Theme interface + defaultTheme + recipes).
- `client/src/provider/theme/global-styles.ts` — new file. Exports `useThemeGlobalStyles()` registering `@global` keyframes + body styles.
- `client/src/provider/theme/provider.tsx` — invoke `useThemeGlobalStyles()`.
- `client/src/provider/theme/index.ts` — re-export anything added.
- `client/src/provider/theme/provider.test.tsx` — rewritten to assert the new token shape. (The existing test asserts `theme.colors.primary === '#1e40af'` while the current theme stores `#083FBC` — the test is already stale; we update it to read from the new structure rather than perpetuate the drift.)

No component files touched yet. Build still passes because new theme keys are additions; old keys (`colors`, `borderRadius`, `shadows`, `text`) are kept temporarily as compatibility aliases pointing at new tokens, so existing components compile unchanged.

### Phase 2 — Migrate controls

Heaviest bespoke styling:
- `control/button/style.ts`
- `control/text-input/style.ts`
- `control/text-area/style.ts`
- `control/number-input/style.ts`
- `control/switch/style.ts`
- `control/confirm-modal/style.ts`
- `control/set-progress-modal/style.ts`
- `control/delete-book-button/style.ts`
- `control/proportional-chapter-slider/style.ts`
- `control/field-list/style.ts`

### Phase 3 — Migrate components

- `component/card/style.ts`, `card-row/style.ts`, `collapsible-section/style.ts`
- `component/page/style.ts`, `header/style.ts`, `toast/style.ts`
- `component/cover/style.ts`, `cover-stack/style.ts`, `metadata/style.ts`, `metadata-list/style.ts`, `tag/style.ts`
- `component/book-row/style.ts`, `series-row/style.ts`, `user-row/style.ts`, `user-row-content/style.ts`, `user-progress-row/style.ts`, `upload-item/style.ts`
- `component/user-list/style.ts`, `user-register/style.ts`, `library-scan/style.ts`, `chapter-progress/style.ts`, `progress-indicator/style.ts`, `upload-zone/style.ts`

### Phase 4 — Migrate pages

- `page/series/style.ts`, `book/style.ts`, `book-edit/style.ts`, `library/style.ts`, `login/style.ts`, `upload/style.ts`

### Phase 5 — Remove legacy aliases & verify

- Delete the legacy `colors` / `borderRadius` / `shadows` / `text` aliases on the `Theme` interface (they were kept in Phase 1 only to let the build pass between phases).
- `npm test` — all existing tests pass.
- `npm run lint` — no new warnings (per `feedback_lint_in_task_review.md`).
- Start dev server, walk through pages, confirm visual fidelity.

## Token derivation

Color tokens are derived from the audit; the table below shows the mapping from current literals to new tokens. Each row indicates which palette slot each shade collapses into.

### Grays
| Slot | Value | Replaces literals from |
|---|---|---|
| `gray.50` | `#FAFAFA` | card, card-row, collapsible-section, confirm-modal, set-progress-modal |
| `gray.100` | `#EEEEEE` | confirm-modal, set-progress-modal, collapsible-section, text-area, number-input, text-input, button |
| `gray.150` | `#e5e7eb` | upload-item bar bg, proportional-chapter-slider track + tick (via existing `theme.colors.borderLight`) |
| `gray.200` | `#DDDDDD` | card-row, collapsible-section, confirm-modal, set-progress-modal |
| `gray.300` | `#D9D9D9` | button, switch, number-input, text-area, text-input |
| `gray.400` | `#D0D0D0` | confirm-modal, set-progress-modal |
| `gray.500` | `#9ca3af` | book, tag |
| `gray.600` | `#6E6E6E` (canonical) — `#6d6d6d` and `#6b7280` collapse here | label, button (loading text, disabled text) |
| `gray.700` | `#5A6375` | confirm-modal body text |
| `gray.900` | `#111` (canonical; `#1f1f1f` and `#1e1e1e` collapse here) | button text, header text |

### Blues (brand palette)

The codebase currently renders **two distinct primary blues** in different roles:
- `#083FBC` (dark navy) — via `theme.colors.primary` in pages (series, book, book-edit, login), proportional-chapter-slider, series-row. Used for accent text, link color, slider fill, focus borders on form rows.
- `#1777FF` (medium blue) — via literal in button-primary, switch toggle, upload-item bar, upload-zone drag-target, progress-indicator. Used for CTA backgrounds.

These are visibly different shades, so the new theme exposes both rather than collapsing them. Two semantic roles:
- **`brand`** = button/CTA color (the medium `#1777FF`)
- **`accent`** = text/border accent color (the dark `#083FBC`)

| Slot | Value | Replaces |
|---|---|---|
| `blue.50` | `#EFF6FF` | tag light bg |
| `blue.100` | `#dbeafe` | upload-zone drag-over |
| `blue.200` | `#91CAFF` | button outline, input focus outline |
| `blue.300` | `#87BAFF` | button loading hover, book-row link hover |
| `blue.400` | `#3696fe` (canonical; `#3f96fe` collapses here) | button primary hover, link hover, default button hover |
| `blue.500` | `#1777FF` | brand CTA default — button primary, switch, upload-item, progress-indicator |
| `blue.600` | `#1D4ED8` | tag dark |
| `blue.700` | `#0758d9` | brand active — button active, input focus border |
| `blue.800` | `#083FBC` | accent — page link, series-row title, slider fill, book-edit border-on-hover |

`#73A6FF` (button primary loading base) and `#6893e7` (button loading active) are single-component shades exposed only via brand semantics below.

Brand semantic aliases (button/CTA family):
- `brand.default` = `blue.500` (`#1777FF`)
- `brand.hover` = `blue.400` (`#3696fe`)
- `brand.active` = `blue.700` (`#0758d9`)
- `brand.light` = `blue.50`
- `brand.outline` = `blue.200`
- `brand.loading` = `#73A6FF`
- `brand.loadingHover` = `blue.300`
- `brand.loadingActive` = `#6893e7`

Accent semantic aliases (text/border accent family):
- `accent.default` = `blue.800` (`#083FBC`)
- `accent.hover` = `blue.700` (`#0758d9`) — used for slider thumb hover etc.

`theme.colors.primaryHover = '#1d4ed8'` resolves to the same hex as `blue.600` (`#1D4ED8`); the rendering is preserved when those references migrate. `theme.colors.primaryLight = '#eff6ff'` is the same hex as `blue.50`; preserved. `theme.colors.primaryBorder = '#bfdbfe'` has zero `style.ts` references (verified by grep) and is dropped.

### Reds (danger palette)
| Slot | Value | Replaces |
|---|---|---|
| `red.50` | `#fff1f0` | button text-danger hover bg |
| `red.100` | `#FFA8A6` | button danger loading hover |
| `red.300` | `#ff7874` (canonical; `#ff7874aa` becomes `applyTransparency(red.300, 0.67)`) | button danger hover |
| `red.400` | `#FF8E8E` | button primary danger loading |
| `red.500` | `#FF4D4F` | danger default — button danger, label danger, input danger, modal icon danger |
| `red.600` | `#e98182` | button danger loading active |
| `red.700` | `#D9373e` | button danger active |

Danger semantic aliases:
- `danger.default` = `red.500`
- `danger.hover` = `red.300`
- `danger.active` = `red.700`
- `danger.light` = `red.50`
- `danger.outline` = `applyTransparency(red.300, 0.5)` (button danger focus outline)
- `danger.loading` = `red.400`
- `danger.loadingHover` = `red.100`
- `danger.loadingActive` = `red.600`

### Background / text / border semantics
| Token | Value | Source |
|---|---|---|
| `bg.page` | `#FFFFFF` | existing theme, currently the only correctly-applied token |
| `bg.card` | `gray.50` | card, card-row |
| `bg.cardHeader` | `gray.100` | card header, modal footer |
| `bg.input` | `#FFFFFF` | text-input, button default |
| `bg.footer` | `gray.100` | modal footer |
| `text.primary` | `gray.900` | body text, button text |
| `text.secondary` | `gray.700` | confirm-modal body |
| `text.muted` | `gray.600` | label, card-header title |
| `text.faint` | `gray.500` | subtitle, placeholder |
| `text.onPrimary` | `#FFFFFF` | button primary text |
| `text.onDanger` | `#FFFFFF` | button danger text |
| `border.default` | `gray.300` | input border, button border |
| `border.strong` | `gray.200` | card-header bottom border, modal footer top border |
| `border.light` | `gray.150` | progress-bar bg, slider track bg (replaces `theme.colors.borderLight`) |
| `border.focus` | `blue.700` | input focus border |
| `border.hover` | `blue.200` | input hover border |
| `border.danger` | `red.500` | input danger border |
| `success` | `#16a34a` | series-row check icon, upload-item success, toast success icon |
| `overlay.backdrop` | `rgba(0,0,0,0.7)` | modal `::backdrop` |

### Spacing scale
| Token | Value | Top use sites |
|---|---|---|
| `space.xxs` | `0.125rem` | micro margins (book pill, user-row-content) |
| `space.xs` | `0.25rem` | page padding, library spacing |
| `space.sm` | `0.375rem` | book-edit padding, user-progress-row margin |
| `space.md` | `0.5rem` | **most common** — card padding, button gap, modal footer gap, input padding |
| `space.lg` | `0.625rem` | book pill padding |
| `space.xl` | `0.75rem` | card content padding, card-header padding, modal footer padding |
| `space.xxl` | `1rem` | modal body padding, header padding, button padding (horizontal) |
| `space.xxxl` | `1.25rem` | series row gap |
| `space.xxxxl` | `1.5rem` | modal body bottom padding, login form gap |
| `space.xxxxxl` | `2rem` | library top padding, page margin (vertical) |

(`0.2rem` and `0.3em` literals — only 5 + 2 uses — round to `space.xs` and `space.xs` respectively; this is one of the deliberate small consolidations.)

### Radii
| Token | Value | Use |
|---|---|---|
| `radius.sm` | `4px` | book-row badge, user-register, book-edit/book/login form-field rounding |
| `radius.md` | `8px` | default — all inputs, buttons, book-row, cover-stack |
| `radius.lg` | `16px` | modal dialog, card root |
| `radius.circle` | `50%` | switch thumb, slider thumb |

The old `borderRadius.pill = 20px` slot is dropped — no component references it (verified by grep over `style.ts`).

### Font sizes
| Token | Value | Use |
|---|---|---|
| `fontSize.xs` | `0.7rem` | small labels, subtitle |
| `fontSize.sm` | `0.75rem` | tag, progress-indicator, upload-zone, form-control text |
| `fontSize.md` | `0.875rem` | **body default** — label, card-header title, page list items |
| `fontSize.lg` | `1rem` | series row title, book-edit field |
| `fontSize.xl` | `1.25rem` | modal header, page heading |
| `fontSize.xxl` | `1.75rem` | set-progress-modal chapter number |

(`0.8rem` and `0.85rem` — 2 + 2 uses — round to `fontSize.sm`.)

### Font weights
| Token | Value | Use |
|---|---|---|
| `fontWeight.medium` | 500 | book row title |
| `fontWeight.semibold` | 600 | **most common** — labels, headings, card titles |
| `fontWeight.bold` | 700 | page headings |
| `fontWeight.extrabold` | 800 | user-row-content, delete-book-button |

### Shadows
| Token | Value | Use |
|---|---|---|
| `shadow.card` | `0 1px 3px rgba(0,0,0,0.07)` | currently `theme.shadows.card`, used by user-list, collapsible-section |
| `shadow.cardStack` | `0px 2px 0px rgba(217,217,217,0.2)` | card root, card-row |
| `shadow.dangerStack` | `0px 2px 0px rgba(255,77,79,0.1)` | button danger |
| `shadow.brandStack` | `0px 2px 0px rgba(23,119,255,0.2)` | button primary |
| `shadow.hoverLift` | `0 2px 8px rgba(0,0,0,0.15)` | toast (replaces existing `theme.shadows.cover`); also reusable by cover-stack |

### Transitions
| Token | Value | Use |
|---|---|---|
| `transition.fast` | `0.1s ease-in` | button, switch, header navigation |
| `transition.slide` | `0.2s ease-out` | toast slide-in |
| `transition.slow` | `0.3s linear` | user-row-content chevron rotation |

### z-index
| Token | Value | Use |
|---|---|---|
| `zIndex.behind` | `-1` | page noise overlay |
| `zIndex.base` | `1` | form inputs |
| `zIndex.stack.lo` | `1` | cover-stack bottom card |
| `zIndex.stack.md` | `2` | cover-stack middle card |
| `zIndex.stack.hi` | `3` | cover-stack top card |
| `zIndex.header` | `10` | header title/actions |
| `zIndex.sticky` | `1000` | header sticky bar |
| `zIndex.toast` | `9999` | toast root |

## Risks & mitigations

- **Pixel drift from collapsed shades.** Two near-identical hex shades that differ only in the last digit (`#3696fe` vs `#3f96fe`, `#6E6E6E` vs `#6d6d6d`) collapse into one canonical slot. Mitigation: per-component visual review in Phase 5; any *visibly* different rendering reverts to a unique slot.
- **Theme bloat.** Recipes are gated by the ≥2-components-and-≥3-declarations rule. Tokens consolidate where shades are near-identical; distinct shades keep distinct slots.
- **Migration breakage between phases.** Phase 1 keeps old top-level keys (`colors`, `borderRadius`, `shadows`, `text`) as alias-objects pointing at new tokens, so unmigrated components compile. Phase 5 deletes these.
- **JSS-keyframe-reference scoping.** A globally-registered `@keyframes theme-rotation` is referenced by component rules as `animation: 'theme-rotation 1s infinite linear'` (no `$` prefix because the keyframe lives in a different stylesheet than the consumer). Verified pattern; if JSS sheet ordering becomes an issue in tests, the keyframe is re-registered in `recipe.spinner` itself as a local fallback.
- **Tests asserting computed styles.** None found in the inventory; tests are behavioural (`render`, `getByText`, `userEvent`). If any do break, the test is updated to assert theme references rather than literals.

## Out of scope

- Component-API changes / new wrapper components (`<ModalShell>`, `<InputFrame>`, etc.)
- Dark mode / multi-theme support (the structure leaves room; no second theme is built)
- Visual redesign — values are derived from current rendering
- Performance work (JSS already memoizes; recipe spread of plain objects is cheap)
- Server / build / dependency changes
