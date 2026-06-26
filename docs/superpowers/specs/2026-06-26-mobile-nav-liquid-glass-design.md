# Mobile Navigation — iOS Liquid Glass Redesign

**Date:** 2026-06-26
**Branch:** navigation-update
**Status:** Approved design

## Problem

The mobile navigation is a fixed, rounded **white pill** floating at the bottom of a
**white page** (`color.bg.page = #FFFFFF`). With no border, shadow, or blur, it has
effectively zero contrast against the background — it visually melts into the page.

We want it to (a) stand out clearly from the background and (b) emulate a native iOS 26
"liquid glass" floating tab bar.

## Goals

- Make the bar legible against the white page through **depth** (translucency + blur +
  shadow + hairline edges), not just color.
- Emulate iOS 26's floating-capsule liquid-glass aesthetic, including a moving active
  highlight and touch feedback.
- **Enshrine all visual values as theme tokens / recipes** — no inline magic numbers in
  the component. This matches existing patterns (`recipe.card.shell`, `recipe.input`,
  `recipe.modal`).
- Light theme only (the app has no dark theme).
- **Desktop is untouched** — every change lives inside `theme.breakpoint.mobile`.

## Non-goals

- No dark-mode variant.
- No change to page layout / scroll padding (existing `paddingBottom: 110px` already
  clears the bar).
- No new navigation items or routing changes.

## Design

### Form factor

Keep the existing **floating capsule** (fixed, centered, above the safe-area inset). It is
re-skinned as frosted liquid glass and its corner radius is raised to a full capsule (pill).

### Visual treatment — the glass

Contrast comes from depth, not color. The capsule surface:

- **Fill:** translucent white (`rgba(255,255,255,0.6)`) so scrolling content tints it.
- **Backdrop:** `blur(20px) saturate(180%)` (with `-webkit-` prefix). The saturation boost
  is what makes colorful book covers bloom through the glass — the "liquid" look.
- **Edges:** 1px even outer hairline (`rgba(0,0,0,0.08)`). (A directional top sheen was
  tried and dropped — on a rounded pill it read as an uneven, top-heavy white edge.)
- **Shadow:** `0 8px 32px rgba(0,0,0,0.12)` to lift it off the white background — the
  primary source of separation/contrast.
- **Shape:** full capsule via a `pill` radius token.

> **The `backdrop-filter` is its own layer, not the capsule.** Safari and Firefox trap
> positioned descendants of a `backdrop-filter` element in a stacking sandbox where they
> don't repaint/animate — which broke the lens's morph entirely in those browsers. So the
> frosted fill lives in a separate `glass` layer (`position: absolute; inset: 0`) and the
> lens + tabs are its **siblings**, free to animate. The capsule itself is a plain grid.

### Equal-width tabs + the sliding glass lens

Tabs are made **equal width** with a CSS grid (`grid-auto-columns: 1fr`, sized to the widest
label). Equal widths mean the lens has a **constant width** and only ever needs to *slide*
(translate) between tabs — never resize — which is the simplest, most robust thing to animate
cross-browser.

The selection indicator is a **single neutral glass lens** (`recipe.glassHighlight`:
translucent bright white `rgba(255,255,255,0.55)`, a 1px even specular edge `rgba(255,255,255,0.7)`,
a soft float shadow, full `radius.pill`). Its **vertical** extent is fixed in CSS (`top`/`bottom`
insets, so it's concentric with the capsule); its **horizontal** position + width come from
measuring the active tab. When the route maps to no tab, the lens fades to `opacity: 0`.

### Blue active color — revealed under the lens (clip-path)

The active color must appear **only where the lens is**, not the instant a tab becomes active.
So the real tab links are rendered **transparent** (kept for layout, clicks, and `aria-current`),
and the visible text comes from **two absolute overlays that share one shrink-to-fit grid** — a
full **gray** layer and a **blue** layer on top. Because both overlays round to the exact same
device pixels, blue overlays gray with no sub-pixel fringe. The blue layer is clipped to a
**`clip-path` window** matching the lens box; as the lens slides, the window animates across the
fixed blue layer, *unmasking* each tab's blue (a passed-over middle tab briefly lights up).

### Motion

- **Lens slide:** a `useEffect` (post-paint, so the transition starts from the painted position)
  measures the active tab's horizontal box via `getBoundingClientRect` (`left` minus the
  capsule's `clientLeft`, `width`, plus the capsule width) and applies it as inline
  `transform: translateX` + `width`. Re-measures on active-tab / admin-set change and on
  `ResizeObserver` (guarded for non-DOM envs).
- **Compositor-only:** the lens animates `transform` (and the reveal `clip-path`) — never
  `width` — so the slide runs on the compositor and stays smooth even while a freshly-navigated
  page loads on the main thread. Easing is `transition.spring` (`cubic-bezier(0.4, 0, 0.2, 1)`).
- **Deferred transition:** the morph transition (`lensReady` / `revealReady`) is added **one
  frame after mount**, decoupled from any position change — Safari/Firefox won't start a
  transition enabled in the same frame its value changes, and this also makes the first
  placement jump in (no slide-in from the corner).
- **Persistence:** `<Nav>` is hoisted into a persistent `NavLayout` route so it survives
  page navigations — otherwise it re-mounted per page and the lens jumped instead of sliding.

### Fallbacks & accessibility

- `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
  → opaque capsule fill (`rgba(255,255,255,0.92)`) so the bar is never an unreadable
  transparent blob on browsers without backdrop-filter.
- `@media (prefers-reduced-motion: reduce)` → the lens and reveal **snap** (the
  `transform` / `clip-path` transitions drop to `opacity` only); the gentle opacity fade stays.
- The lens and the gray/blue overlays are decorative (`aria-hidden`, `pointer-events: none`);
  the active link carries `aria-current="page"` (which is also the mobile measurement hook).

## Theme changes (`app/client/src/provider/theme/theme.ts`)

All glass values are added as tokens and one recipe; the `Theme` interface is extended to
match. New tokens:

- `color.bg.glass` = `rgba(255,255,255,0.6)` — translucent capsule fill.
- `color.bg.glassFallback` = `rgba(255,255,255,0.92)` — opaque fill when backdrop-filter
  is unsupported.
- `color.border.glass` = `rgba(0,0,0,0.08)` — outer hairline.
- `shadow.glass` = `0 8px 32px rgba(0,0,0,0.12)` — even float shadow (no directional sheen).
- `radius.pill` = `999px` — full capsule.
- `transition.spring` = `0.35s cubic-bezier(0.4, 0, 0.2, 1)` — lens slide / reveal easing.
- `recipe.glass` — spreadable surface fragment bundling fill, `backdrop-filter` (+ webkit),
  hairline border, `shadow.glass`, and the `@supports` opaque fallback. Mirrors how
  `recipe.card.shell` bundles a surface today. Spread into the `glass` background layer.

Active-lens tokens (the selection glass):

- `color.bg.glassActive` = `rgba(255,255,255,0.55)` — bright translucent lens fill.
- `color.border.glassActive` = `rgba(255,255,255,0.7)` — even specular lens edge.
- `shadow.glassActive` = `0 2px 6px rgba(0,0,0,0.12)` — even float shadow.
- `recipe.glassHighlight` — spreadable fragment bundling the lens fill, edge, and shadow.
  Spread into the `lens` rule.

(The earlier `color.brand.glassHighlight` blue-tint token is removed — the lens is neutral glass.)

## Component structure

The navigation is split into three components under `app/client/src/component/`, so the
desktop and mobile layouts each stay single-purpose:

- **`nav/`** (`Nav`) — owns the destinations: builds the `NavItem[]` (route, label, icon,
  `active` from `pathname`, admin "Users" spread in only when admin) and renders **both**
  layouts. Each layout hides itself at the wrong breakpoint via CSS (`display: none`, which
  also drops it from the accessibility tree), so exactly one is ever visible. Shares the
  `NavItem` type from `nav/types.ts`.
- **`nav-desktop/`** (`NavDesktop`) — the wide sticky top bar: a horizontal row of
  icon+label links with the noise overlay; the active link gets a gray underline. `root`
  hides at `theme.breakpoint.mobile`.
- **`nav-mobile/`** (`NavMobile`) — the narrow bottom glass capsule with the morphing lens
  (below). `root` hides at `theme.breakpoint.normal`.

The active link in both layouts carries `aria-current="page"` (accessibility, and the hook
the mobile measurement queries).

`<Nav>` is rendered once by a **persistent `NavLayout` route** (`router/nav-layout.tsx`) that
wraps the nav-bearing protected routes (`<Nav /> + <Outlet />`), rather than inside each page's
`<Page>`. This keeps it mounted across navigations so the lens animates from the real previous
tab instead of re-mounting and jumping. Nav-less routes (login, password-reset) sit outside it.

### `nav-mobile` internals

- **Layers (z-order):** `glass` (frosted backdrop-filter layer, `inset:0`) → `lens` (sliding
  glass pill) → transparent interactive tab links → `grayLayer` (gray text overlay) → `reveal`
  (blue text overlay, clipped). The two text overlays are absolute, shrink-to-fit, same grid →
  identical rounding → no fringe.
- **Measurement:** a `useEffect` (post-paint) measures the active tab's horizontal box via
  `getBoundingClientRect` (`left` minus capsule `clientLeft`, `width`, plus capsule width) into
  `box` state. Re-runs on active-tab / admin change and on `ResizeObserver` (guarded).
- **Lens:** vertical extent fixed in CSS (`top`/`bottom` insets ⇒ concentric); `left`/`width`
  inline. Slides via `transform` only (constant width). `lensReady` (added one frame after
  mount) turns on the `transform` transition; reduced-motion drops it to `opacity` only (snap).
- **Reveal:** `clip-path: inset(... round pill)` set inline to the lens window, animated via
  `revealReady` (`clip-path` transition; reduced-motion → `opacity` only). The blue layer never
  moves — the window animates across it.

## Files touched

- `app/client/src/provider/theme/theme.ts` — glass + active-lens tokens, `recipe.glass` +
  `recipe.glassHighlight`; `Theme` interface extended; `brand.glassHighlight` removed.
- `app/client/src/component/nav/` — `index.tsx` (`Nav`), `types.ts` (`NavItem`), test.
- `app/client/src/component/nav-desktop/` — `index.tsx`, `style.ts`, test.
- `app/client/src/component/nav-mobile/` — `index.tsx` (measurement + lens + clip-path reveal),
  `style.ts`, test.
- `app/client/src/router/nav-layout.tsx` + `router/component.tsx` — persistent `NavLayout` route.
- `app/client/src/component/page/index.tsx` + `component/index.ts` — render/export `Nav`; the
  page's mobile top padding restores the spacing the old static header provided.

## Verification

- `npm run lint` (from repo root), `npm run type`, full test suite, and `npm run build` pass.
  `nav-mobile` tests inspect the generated stylesheet to assert the `@supports` opaque fallback
  and the `prefers-reduced-motion` rule actually emit.
- Manual check on a mobile viewport (Chrome, Safari, Firefox): bar reads as frosted glass
  distinct from the white page; colorful content tints it while scrolling under; the lens
  **slides** between equal-width tabs and reveals each tab's blue as it passes; tabs are
  pixel-aligned; admin/non-admin tab sets both work.
- Reduced-motion: lens/reveal snap (no slide). Backdrop-filter fallback: opaque capsule.
