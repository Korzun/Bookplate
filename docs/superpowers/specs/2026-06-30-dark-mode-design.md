# Dark Mode — Light/Dark/Auto Theme

**Date:** 2026-06-30
**Branch:** dark-mode
**Status:** Approved design

## Problem

The app ships a single hard-coded theme. `buildTheme()` in
`app/client/src/provider/theme/theme.ts` produces one `defaultTheme`, and
`ThemeProvider` (`provider/theme/provider.tsx`) passes it statically to JSS's
`JssThemeProvider`. There is no dark palette, no user setting, and no switching.

We want a **dark mode** alongside the existing light palette, a user setting on the
settings page offering **Light / Dark / Auto**, and a theme provider that switches the
active theme — persisting the choice and, in Auto, following the OS live.

## Goals

- Add a hand-authored **dark palette** covering every color-bearing token.
- Re-namespace the current palette as the **light** palette; light mode stays
  **byte-identical** to today (regression-guarded by a test).
- Settings page gains a **Light / Dark / Auto** control.
- Theme provider switches light/dark, **persists** the choice in `localStorage`, and in
  **Auto** follows `prefers-color-scheme` **live** via `matchMedia`.
- Keep the theme the single source of truth — no per-component dark hacks, no inline
  magic colors.

## Non-goals

- No redesign of any existing component beyond what dark mode requires.
- No server-side persistence or per-account sync — the setting is device-local.
- No change to structural tokens (spacing, radius, type, motion, z-index, breakpoints).

## Design

### 1. `buildTheme(mode)` — two themes from one builder

Refactor `buildTheme()` to take a resolved mode:

```ts
export type ThemeMode = 'light' | 'dark';
function buildTheme(mode: ThemeMode): Theme { … }

export const lightTheme: Theme = buildTheme('light');
export const darkTheme: Theme = buildTheme('dark');
export const defaultTheme: Theme = lightTheme; // back-compat alias
```

- **Structural tokens are mode-independent** and defined once, identical in both modes:
  `space`, `radius`, `size`, `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`,
  `transition`, `zIndex`, `breakpoint`.
- **Color-bearing output varies by mode**: the entire `color` tree, `shadow`, and the
  color-referencing parts of `recipe` (the recipes are rebuilt from the mode's `color`,
  so e.g. `recipe.glass` derives from that mode's glass tokens, exactly as today).
- The `Theme` **interface shape is unchanged** — only values differ — so `useTheme()`
  consumers and the JSS surface are untouched.
- `defaultTheme` stays exported as an alias of `lightTheme` so `test-utils.tsx` and the
  existing theme tests need no churn.

The raw `gray` / `blue` / `red` primitive ramps remain as internal source values used to
compose the light semantic tokens. They are no longer referenced directly by components
(see §2).

### 2. Migrate raw-scale refs to semantic tokens

Nine `style.ts` files reference the raw ramps directly, but **semantically**:

| Raw ref (light value) | Meaning in use | New semantic token (light value = identical) |
| --- | --- | --- |
| `gray[900]` (`#111`) | primary text / strong foreground | `text.primary` (already `gray[900]`) |
| `gray[500]` (`#9ca3af`) | subtle/faint border | **new** `border.faint` = `gray[500]` |
| `blue[300]` (`#87BAFF`) | link / hover accent | **new** `brand.linkHover` = `blue[300]` |
| `blue[100]` (`#dbeafe`) | selected / highlight background | **new** `bg.selected` = `blue[100]` |

The one `applyTransparency(gray[900], 0.467)` ref in `nav-desktop` becomes
`applyTransparency(text.primary, 0.467)` (identical output in light).

Rules:
- Every new token's **light value equals today's raw value exactly** → zero visual change
  in light mode.
- After migration, **no component references `theme.color.gray/blue/red[...]` directly**;
  the ramps are internal to `theme.ts`.
- Each new token gets a **dark** value in the dark palette (§3), so these sites adapt
  automatically.

Affected files (all `app/client/src`):
`component/book-row/style.ts`, `component/nav-mobile/style.ts`,
`component/nav-desktop/style.ts`, `component/search-bar/style.ts`,
`component/book-lineage-row/style.ts`, `component/book-lineage-merge-row/style.ts`,
`component/upload-zone/style.ts`, `control/button/style.ts`, `control/select/style.ts`.

The `Theme` interface gains `border.faint`, `brand.linkHover`, and `bg.selected`.

### 3. The dark palette

Hand-authored dark values for every semantic token. Approximate intent (final values
tuned during implementation):

- **Surfaces** — `bg.page` near-black (e.g. `#0E0F11`), `bg.card` a step lighter
  (`#1A1B1E`), `bg.cardHeader`/`bg.footer`/`bg.input` tuned for layering; surfaces get
  *lighter* with elevation (dark-mode convention).
- **Text** — `text.primary` near-white (`#F5F5F5`), with `secondary`/`muted`/`faint`
  stepping down in contrast; `onPrimary`/`onDanger` stay light.
- **Borders** — low-contrast light-on-dark hairlines; `focus`/`hover` keep a visible
  brand tint; `border.faint` a faint dark-surface divider.
- **Brand / danger** — base hues lightened for legibility on dark surfaces; `*.light`
  tints become low-alpha brand-on-dark rather than near-white; `brand.linkHover` a
  lighter blue.
- **Glass** — translucent **dark** (iOS dark glass), e.g. `bg.glass` from
  `applyTransparency('#1C1C1E', …)`, with the fallback opaque-dark and the glass borders
  switched to light low-alpha hairlines.
- **Shadows** — deeper/darker for dark surfaces.
- **Chips** — dark-surface tints (lighter text, low-alpha fills/borders).
- **`bg.selected`** — a dark-surface selected background.

`success` and the raw ramps are unchanged.

### 4. Theme switching, persistence, live OS sync

Built inside `provider/theme/`, mirroring the `provider/library-target` idiom (state +
`localStorage` + `Context` + hook).

- **Setting type:** `ThemeSetting = 'light' | 'dark' | 'auto'` (the user choice), distinct
  from `ThemeMode = 'light' | 'dark'` (the resolved render mode).
- **`context.ts`** exposes `{ setting, setSetting, resolvedMode }` with a sensible default.
- **`provider.tsx`**:
  - Holds `setting` in `useState`, initialized from `localStorage` (key `theme-setting`),
    defaulting to `'auto'`.
  - `setSetting` writes through to `localStorage` and updates state.
  - Subscribes to `matchMedia('(prefers-color-scheme: dark)')`; on change, if the current
    setting is `'auto'`, the resolved mode updates **live**.
  - Computes `resolvedMode` = `setting === 'auto' ? (mql.matches ? 'dark' : 'light') : setting`.
  - Passes `resolvedMode === 'dark' ? darkTheme : lightTheme` to `JssThemeProvider`.
- **`use-theme-setting.ts`** hook → `[setting, setSetting]` (resolvedMode also available
  via context for any consumer that needs it). Existing `use-theme.ts` (JSS theme
  consumer) is unchanged.
- **`global-styles.ts`**: set `color-scheme` on `body` to the resolved mode so native
  controls/scrollbars match. (Body `backgroundColor`/`color` already come from theme
  tokens, so they follow automatically.)

`ThemeProvider` keeps its position in the providers tree (`App.tsx`); its props/signature
are unchanged.

### 5. Segmented control

New reusable control `control/segmented-control/` (kebab-case, colocated `style.ts` +
test), styled to match the card/glass aesthetic.

- **Props:** `{ name, value, options: { value: string; label: string }[], onChange:(value)=>void, disabled? }` — generic, not theme-specific.
- **Look:** a rounded card-shell track (`bg.card` / `border` / `radius.pill`) with a
  sliding active **lens** reusing `recipe.glassHighlight` (the same active-highlight
  language as the mobile nav).
- **A11y / keyboard:** `role="radiogroup"` with `role="radio"` segments, arrow-key
  navigation and Enter/Space selection, following the `control/switch` a11y idiom.

### 6. Settings page integration

New `component/theme-setting/` — a labeled row wrapping the segmented control, wired to
`useThemeSetting`, with options **Light / Dark / Auto**.

Added to `page/user/index.tsx` in **both** the admin and regular branches (so the setting
is always reachable), placed near the top of the page body.

### 7. Testing

- **`theme.test.ts`** — extend:
  - Light-mode regression guard (existing glass-token assertions continue to pass against
    `lightTheme`/`defaultTheme`).
  - Dark tokens present and correctly dark (`darkTheme.color.bg.page` is dark,
    `darkTheme.color.text.primary` is light).
  - Structural tokens are referentially/equal across `lightTheme` and `darkTheme`
    (`space`, `radius`, `fontSize`, etc.).
  - New tokens (`border.faint`, `brand.linkHover`, `bg.selected`) equal their prior raw
    values in light.
- **Provider test** — `localStorage` persistence of the setting; Auto resolves from
  `matchMedia` and updates live on a simulated OS change.
- **Segmented-control test** — renders options, selects via click and keyboard, fires
  `onChange`, reflects `value`.
- **theme-setting component test** — reflects current setting and calls `setSetting`.

## Risks / mitigations

- **Light-mode regression from §2 migration** → every new token's light value is set
  exactly equal to the raw value it replaces; covered by the regression test.
- **JSS re-render on theme switch** → switching the `theme` object prop on
  `JssThemeProvider` re-renders styles by design; acceptable and the intended mechanism.
- **`matchMedia` in tests (jsdom)** → stub `window.matchMedia` in the provider test
  (jsdom lacks it); add to test setup if not already present.

## Files touched (summary)

- `provider/theme/theme.ts` — `buildTheme(mode)`, light/dark, new tokens, interface.
- `provider/theme/context.ts` *(new)*, `provider/theme/provider.tsx` — setting state +
  persistence + live OS sync.
- `provider/theme/use-theme-setting.ts` *(new)*, `provider/theme/index.ts` — exports.
- `provider/theme/global-styles.ts` — `color-scheme`.
- `control/segmented-control/*` *(new)*.
- `component/theme-setting/*` *(new)*, `component/index.ts`.
- `page/user/index.tsx` — render the setting.
- 9 component/control `style.ts` files — raw-ref → semantic-token migration.
- Tests as listed in §7.
