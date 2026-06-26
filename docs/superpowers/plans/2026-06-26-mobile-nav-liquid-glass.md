# Mobile Nav — iOS Liquid Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the mobile bottom navigation as a native-feeling iOS 26 "liquid glass" floating capsule — frosted translucency, a sliding active-highlight pill, and press feedback — so it reads clearly against the white page.

**Architecture:** All glass visual values live in the theme (`theme.ts`) as tokens plus a `recipe.glass` spreadable surface fragment, mirroring the existing `recipe.card.shell`/`recipe.input` pattern. The header component (`component/header/`) becomes data-driven: nav items are an array, the active item's index is published to CSS as a `--active-index` custom property, and a single persistent highlight element translates to that index with a spring transition. All visual changes are scoped to `theme.breakpoint.mobile`; desktop is untouched.

**Tech Stack:** React 18, `react-jss` (CSS-in-JS), TypeScript, Vite, Vitest + `@testing-library/react` (via the project's `renderWithProviders` helper).

**Spec:** `docs/superpowers/specs/2026-06-26-mobile-nav-liquid-glass-design.md`

## Global Constraints

- **Enshrine every glass value as a theme token or recipe.** No inline magic numbers (colors, blur, shadow, radius, easing) in the component or its style file — they reference `theme.*`. The one allowed local constant is `MOBILE_ITEM_WIDTH` in `style.ts` (shared layout geometry, kept DRY between the tab width and the highlight calc).
- **Light theme only** — the app has no dark theme; do not add one.
- **Desktop is untouched** — every visual change lives inside a `[theme.breakpoint.mobile]` block.
- **No page-layout changes** — the existing `paddingBottom: calc(110px + env(safe-area-inset-bottom))` already clears the bar.
- Work stays on the `navigation-update` branch (already checked out).
- Lint runs from the **repo root**: `npm run lint`. Tests run via Vitest.

---

### Task 1: Theme — glass tokens + `recipe.glass`

Add the glass design tokens and the spreadable glass surface recipe, and extend the `Theme` interface to match. A test pins that the recipe references the tokens (the "enshrine into the theme" requirement) rather than hardcoding values.

**Files:**
- Modify: `app/client/src/provider/theme/theme.ts`
- Create: `app/client/src/provider/theme/theme.test.ts`

**Interfaces:**
- Produces (new `Theme` fields, consumed by Tasks 2 & 3):
  - `theme.color.bg.glass: string`, `theme.color.bg.glassFallback: string`
  - `theme.color.border.glass: string`
  - `theme.color.brand.glassHighlight: string`
  - `theme.shadow.glass: string`
  - `theme.radius.pill: string`
  - `theme.transition.spring: string`
  - `theme.recipe.glass: Recipe` — spreadable fragment with `backgroundColor`, `backdropFilter` (+ `-webkit-` prefix), hairline border, `boxShadow`, and a `@supports` opaque fallback.

- [ ] **Step 1: Write the failing test**

Create `app/client/src/provider/theme/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { defaultTheme } from './theme';

describe('defaultTheme glass tokens', () => {
  it('exposes a full-capsule pill radius', () => {
    expect(defaultTheme.radius.pill).toBe('999px');
  });

  it('derives the translucent glass fill from white', () => {
    expect(defaultTheme.color.bg.glass).toBe('rgba(255, 255, 255, 0.6)');
    expect(defaultTheme.color.bg.glassFallback).toBe('rgba(255, 255, 255, 0.92)');
  });

  it('defines a spring easing for the highlight slide', () => {
    expect(defaultTheme.transition.spring).toBe('0.35s cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('builds recipe.glass from the glass tokens (no hardcoded values)', () => {
    const glass = defaultTheme.recipe.glass;
    expect(glass.backgroundColor).toBe(defaultTheme.color.bg.glass);
    expect(glass.borderColor).toBe(defaultTheme.color.border.glass);
    expect(glass.boxShadow).toBe(defaultTheme.shadow.glass);
    expect(glass.backdropFilter).toBe('blur(20px) saturate(180%)');
    expect(glass['-webkit-backdrop-filter']).toBe('blur(20px) saturate(180%)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `app/client`): `npx vitest run src/provider/theme/theme.test.ts`
Expected: FAIL — `defaultTheme.radius.pill` is `undefined` / `recipe.glass` does not exist.

- [ ] **Step 3: Extend the `Theme` interface**

In `app/client/src/provider/theme/theme.ts`, make these edits to the `interface Theme` block:

Change the `bg` line:

```ts
    bg: { page: string; card: string; cardHeader: string; input: string; footer: string };
```
to:
```ts
    bg: {
      page: string;
      card: string;
      cardHeader: string;
      input: string;
      footer: string;
      glass: string;
      glassFallback: string;
    };
```

In the `border` object type, add `glass`:

```ts
    border: {
      default: string;
      strong: string;
      light: string;
      focus: string;
      hover: string;
      danger: string;
      glass: string;
    };
```

In the `brand` object type, add `glassHighlight`:

```ts
    brand: {
      default: string;
      hover: string;
      active: string;
      light: string;
      outline: string;
      loading: string;
      loadingHover: string;
      loadingActive: string;
      glassHighlight: string;
    };
```

Change the `radius` line:

```ts
  radius: { sm: string; md: string; lg: string; circle: string };
```
to:
```ts
  radius: { sm: string; md: string; lg: string; circle: string; pill: string };
```

Change the `shadow` block to add `glass`:

```ts
  shadow: {
    card: string;
    cardStack: string;
    hoverLift: string;
    dangerStack: string;
    brandStack: string;
    glass: string;
  };
```

Change the `transition` line:

```ts
  transition: { fast: string; medium: string; slide: string; slow: string };
```
to:
```ts
  transition: { fast: string; medium: string; slide: string; slow: string; spring: string };
```

In the `recipe` block type, add `glass`:

```ts
  recipe: {
    input: Recipe;
    focusRing: Recipe;
    label: Recipe;
    spinner: Recipe;
    glass: Recipe;
    modal: {
      dialog: Recipe;
      header: Recipe;
    };
    card: {
      shell: Recipe;
      header: Recipe;
    };
  };
```

- [ ] **Step 4: Add the token values in `buildTheme()`**

In the `bg` object inside `buildTheme`, add the two glass fills:

```ts
    bg: {
      page: '#FFFFFF',
      card: gray[50],
      cardHeader: gray[100],
      input: '#FFFFFF',
      footer: gray[100],
      glass: applyTransparency('#FFFFFF', 0.6),
      glassFallback: applyTransparency('#FFFFFF', 0.92),
    },
```

In the `border` object, add `glass`:

```ts
      danger: red[500],
      glass: applyTransparency('#000', 0.08),
    },
```

In the `brand` object, add `glassHighlight` (after `loadingActive`):

```ts
      loadingActive: '#6893e7',
      glassHighlight: applyTransparency(blue[500], 0.12),
    },
```

Change the `radius` const to add `pill`:

```ts
  const radius: Theme['radius'] = { sm: '4px', md: '8px', lg: '16px', circle: '50%', pill: '999px' };
```

In the `shadow` const, add `glass` (float shadow + inner top sheen, composite):

```ts
    brandStack: `0px 2px 0px ${applyTransparency('#1777FF', 0.2)}`,
    glass: `0 8px 32px ${applyTransparency('#000', 0.12)}, inset 0 1px 0 ${applyTransparency('#FFFFFF', 0.7)}`,
  };
```

In the `transition` const, add `spring`:

```ts
    slow: '0.3s linear',
    spring: '0.35s cubic-bezier(0.22, 1, 0.36, 1)',
  };
```

- [ ] **Step 5: Add `recipe.glass`**

In the `recipe` const inside `buildTheme`, add the `glass` fragment (place it after `spinner` and before `modal`):

```ts
    glass: {
      backgroundColor: color.bg.glass,
      backdropFilter: 'blur(20px) saturate(180%)',
      '-webkit-backdrop-filter': 'blur(20px) saturate(180%)',
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: color.border.glass,
      boxShadow: shadow.glass,
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))': {
        backgroundColor: color.bg.glassFallback,
      },
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run (from `app/client`): `npx vitest run src/provider/theme/theme.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 7: Typecheck**

Run (from `app/client`): `npm run type`
Expected: no errors (the `Theme` interface and `buildTheme` return value agree).

- [ ] **Step 8: Commit**

```bash
git add app/client/src/provider/theme/theme.ts app/client/src/provider/theme/theme.test.ts
git commit -m "feat(theme): add liquid-glass tokens and recipe.glass"
```

---

### Task 2: Header styles — glass capsule, highlight, press feedback

Re-skin the mobile nav container as the glass capsule, add the sliding `highlight` rule, and add press feedback to the tab items. Pure styling: verified by typecheck/lint here and exercised by Task 3's component test. Everything is inside `[theme.breakpoint.mobile]`.

**Files:**
- Modify: `app/client/src/component/header/style.ts`

**Interfaces:**
- Consumes (from Task 1): `theme.recipe.glass`, `theme.radius.pill`, `theme.color.brand.glassHighlight`, `theme.transition.spring`, `theme.transition.fast`.
- Produces (consumed by Task 3): a new `highlight` class on the `useStyle` hook; the `navigationItemContainer` becomes a positioning context (`position: relative`) that reads the `--active-index` CSS variable.

- [ ] **Step 1: Replace `style.ts` with the glass version**

Overwrite `app/client/src/component/header/style.ts` with:

```ts
import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

// Mobile tab column width. Shared by the tab items and the sliding highlight so
// their geometry can never drift apart.
const MOBILE_ITEM_WIDTH = '40px';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    backgroundColor: theme.color.bg.page,
    color: theme.color.gray[900],
    padding: `${theme.space.xxl} ${theme.space.xxxxl}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: '0px',
    zIndex: theme.zIndex.sticky,
    overflow: 'hidden',
    [theme.breakpoint.mobile]: {
      backgroundColor: 'transparent',
      position: 'static',
    },
  },
  noise: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: theme.zIndex.behind,
    opacity: 0.2,
    [theme.breakpoint.mobile]: {
      display: 'none',
    },
  },
  navigation: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '15px',
    width: '100vw',
    [theme.breakpoint.mobile]: {
      width: '100vw',
      height: 'auto',
      position: 'fixed',
      top: 'auto',
      bottom: 0,
      left: 0,
      paddingBottom: 'env(safe-area-inset-bottom)',
    },
  },
  navigationItemContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space.xxl,
    [theme.breakpoint.mobile]: {
      ...theme.recipe.glass,
      position: 'relative',
      marginBottom: theme.space.xxxl,
      borderRadius: theme.radius.pill,
      padding: `${theme.space.xl} ${theme.space.xxxxxl}`,
      display: 'inline-flex',
      gap: theme.space.xxl,
    },
  },
  highlight: {
    display: 'none',
    [theme.breakpoint.mobile]: {
      display: 'block',
      position: 'absolute',
      top: theme.space.xl,
      bottom: theme.space.xl,
      left: theme.space.xxxxxl,
      width: MOBILE_ITEM_WIDTH,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.brand.glassHighlight,
      opacity: 0,
      transform: `translateX(calc(var(--active-index) * (${MOBILE_ITEM_WIDTH} + ${theme.space.xxl})))`,
      transition: `transform ${theme.transition.spring}, opacity ${theme.transition.fast}`,
      '&[data-active="true"]': {
        opacity: 1,
      },
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
      },
    },
  },
  navigationItem: {
    gap: theme.space.md,
    color: theme.color.gray[900],
    textDecoration: 'none',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '0.80rem', // header-nav-specific size; not on global fontSize scale
    userSelect: 'none',
    '-webkit-user-select': 'none',
    transitionProperty: 'color, border-bottom-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    borderBottomStyle: 'solid',
    borderBottomWidth: '2px',
    borderBottomColor: 'transparent',
    cursor: 'pointer',
    display: 'inline-flex',
    borderStyle: 'none',
    outlineStyle: 'none',
    paddingBottom: '4px', // optical baseline tweak — geometry
    marginTop: '6px', // optical baseline tweak — geometry
    '&:hover': {
      transitionDuration: '0s',
      color: applyTransparency(theme.color.gray[900], 0.467), // matches old '#11111177'
    },
    '&$active': {
      color: theme.color.gray[900],
      borderBottomColor: theme.color.gray[900],
    },
    [theme.breakpoint.mobile]: {
      position: 'relative',
      zIndex: theme.zIndex.base,
      width: MOBILE_ITEM_WIDTH,
      flexDirection: 'column',
      rowGap: theme.space.xxs,
      transitionProperty: 'color, transform, opacity',
      transitionDuration: '0.1s',
      transitionTimingFunction: 'ease-in',
      '&:active': {
        transform: 'scale(0.92)',
        opacity: 0.7,
      },
      '&$active': {
        color: theme.color.brand.default,
        borderBottomColor: 'transparent',
      },
      '@media (prefers-reduced-motion: reduce)': {
        transitionProperty: 'color',
        '&:active': {
          transform: 'none',
          opacity: 1,
        },
      },
    },
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xl,
    position: 'relative',
    zIndex: theme.zIndex.header,
  },
  active: {},
}));
```

What changed vs. the original (everything else is byte-for-byte identical):
- Added the `MOBILE_ITEM_WIDTH` constant.
- `navigationItemContainer` mobile block: spreads `...theme.recipe.glass`, adds `position: 'relative'`, sets `borderRadius: theme.radius.pill`, and **drops** the old solid `backgroundColor: theme.color.bg.page` (the glass fill replaces it).
- Added the `highlight` rule (hidden on desktop; the sliding pill on mobile).
- `navigationItem` mobile block: adds `position: 'relative'` + `zIndex: theme.zIndex.base` (so items paint above the highlight), uses `MOBILE_ITEM_WIDTH` for `width`, swaps the transition to `color, transform, opacity`, adds `&:active` press feedback, and adds a `prefers-reduced-motion` block that drops the press transform.

- [ ] **Step 2: Typecheck**

Run (from `app/client`): `npm run type`
Expected: no errors.

- [ ] **Step 3: Lint (from repo root)**

Run (from repo root): `npm run lint`
Expected: no errors for `style.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/component/header/style.ts
git commit -m "feat(header): style mobile nav as liquid-glass capsule with sliding highlight"
```

---

### Task 3: Header component — data-driven items, active index, highlight element

Make the header render its nav items from an array, compute the active index, publish it as `--active-index`, and render the persistent highlight element. Tests pin the admin gating, the active-index math (the bug-prone part), and the highlight's active/hidden state.

**Files:**
- Modify: `app/client/src/component/header/index.tsx`
- Create: `app/client/src/component/header/index.test.tsx`

**Interfaces:**
- Consumes (from Task 2): `styles.highlight`, `styles.navigationItemContainer`, `styles.navigationItem`, `styles.active` from `useStyle()`.
- Consumes (existing): `useIsAdmin()` → `[boolean, boolean]`; `useLocation()` → `{ pathname }`; `path.library() === '/library'`, `path.upload() === '/upload'`, `path.userList() === '/users'`, `path.user() === '/user'`.
- Produces: the container div carries inline `style={{ '--active-index': Math.max(activeIndex, 0) }}`; the highlight `<span>` carries `data-active={activeIndex !== -1}`.

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/component/header/index.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { Header } from './index';

const getContainer = () => {
  const nav = screen.getByRole('navigation');
  const container = nav.querySelector('div');
  if (!container) throw new Error('nav container not found');
  return container;
};

describe('Header', () => {
  it('hides the Users tab for non-admins', () => {
    renderWithProviders(<Header />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/library'],
    });
    expect(screen.queryByText('Users')).toBeNull();
  });

  it('shows the Users tab for admins', () => {
    renderWithProviders(<Header />, {
      user: { username: 'admin', isAdmin: true },
      initialEntries: ['/library'],
    });
    expect(screen.getByText('Users')).not.toBeNull();
  });

  it('publishes the active tab index for the current route', () => {
    renderWithProviders(<Header />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/upload'],
    });
    expect(getContainer().style.getPropertyValue('--active-index')).toBe('1');
  });

  it('accounts for the admin tab when computing the active index', () => {
    // admin order: Library(0) Upload(1) Users(2) Settings(3)
    renderWithProviders(<Header />, {
      user: { username: 'admin', isAdmin: true },
      initialEntries: ['/user'],
    });
    expect(getContainer().style.getPropertyValue('--active-index')).toBe('3');
  });

  it('marks the highlight active on a nav route', () => {
    renderWithProviders(<Header />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/upload'],
    });
    const highlight = getContainer().querySelector('[data-active]');
    expect(highlight?.getAttribute('data-active')).toBe('true');
  });

  it('hides the highlight and falls back to index 0 off-nav', () => {
    renderWithProviders(<Header />, {
      user: { username: 'reader', isAdmin: false },
      initialEntries: ['/login'],
    });
    const container = getContainer();
    expect(container.style.getPropertyValue('--active-index')).toBe('0');
    expect(container.querySelector('[data-active]')?.getAttribute('data-active')).toBe('false');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `app/client`): `npx vitest run src/component/header/index.test.tsx`
Expected: FAIL — the container has no `--active-index` style and there is no `[data-active]` element yet (the active-index / highlight assertions fail).

- [ ] **Step 3: Rewrite `index.tsx`**

Overwrite `app/client/src/component/header/index.tsx` with:

```tsx
import cx from 'classnames';
import { type CSSProperties, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { BookIcon, SettingsIcon, UploadIcon, UsersIcon, type IconProps } from '~/icon';
import { useIsAdmin } from '~/provider/auth';
import { path } from '~/router';

import { useStyle } from './style';

interface NavItem {
  to: string;
  label: string;
  Icon: (props: IconProps) => ReactElement;
  active: boolean;
}

export const Header = () => {
  const [isAdmin] = useIsAdmin();
  const styles = useStyle();
  const { pathname } = useLocation();

  const items: NavItem[] = [
    {
      to: path.library(),
      label: 'Library',
      Icon: BookIcon,
      active: pathname.startsWith(path.library()),
    },
    {
      to: path.upload(),
      label: 'Upload',
      Icon: UploadIcon,
      active: pathname === path.upload(),
    },
    ...(isAdmin
      ? [
          {
            to: path.userList(),
            label: 'Users',
            Icon: UsersIcon,
            active: pathname === path.userList(),
          },
        ]
      : []),
    {
      to: path.user(),
      label: 'Settings',
      Icon: SettingsIcon,
      active: pathname === path.user(),
    },
  ];

  const activeIndex = items.findIndex((item) => item.active);
  const containerStyle = { '--active-index': Math.max(activeIndex, 0) } as CSSProperties;

  return (
    <header className={styles.root}>
      <svg className={styles.noise} aria-hidden="true">
        <filter id="header-noise">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.75"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#header-noise)" />
      </svg>
      <nav className={styles.navigation}>
        <div className={styles.navigationItemContainer} style={containerStyle}>
          <span className={styles.highlight} data-active={activeIndex !== -1} aria-hidden="true" />
          {items.map(({ to, label, Icon, active }) => (
            <Link
              key={to}
              className={cx(styles.navigationItem, { [styles.active]: active })}
              to={to}
            >
              <Icon height={14} width={14} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `app/client`): `npx vitest run src/component/header/index.test.tsx`
Expected: PASS (all six tests green).

- [ ] **Step 5: Typecheck + lint**

Run (from `app/client`): `npm run type`
Run (from repo root): `npm run lint`
Expected: no errors. (If lint flags the `as CSSProperties` assertion or the `Icon` typing, prefer adjusting the annotation over a disable directive — per project policy, no lint suppressions.)

- [ ] **Step 6: Commit**

```bash
git add app/client/src/component/header/index.tsx app/client/src/component/header/index.test.tsx
git commit -m "feat(header): drive mobile nav from items array with sliding glass highlight"
```

---

### Task 4: Full verification + manual visual check

Run the whole suite, then confirm the glass look and behavior in a real mobile viewport.

**Files:** none (verification only).

- [ ] **Step 1: Full lint + test sweep**

Run (from repo root): `npm run lint`
Run (from repo root): `npm test`
Expected: all pass.

- [ ] **Step 2: Build**

Run (from repo root): `npm run build`
Expected: client + server build with no type errors.

- [ ] **Step 3: Manual visual check (mobile viewport)**

Start the dev client (`npm run dev:client` from repo root) and open it in a mobile-emulated viewport (DevTools device toolbar, width ≤ 640px). Confirm:
- The bottom nav reads as a frosted-glass capsule clearly separated from the white page (shadow + hairline + blur), not a flat white pill.
- Scrolling colorful content (book covers) under the bar tints/saturates through the glass.
- The capsule is a full pill (fully rounded ends).
- The active highlight pill sits behind the current tab and **slides** to the new tab when you navigate between Library/Upload/Settings (and Users as admin).
- Tabs give a subtle press (scale/dim) feedback on tap/click.
- Visiting a non-nav route (e.g. a book detail page) leaves no highlight visible.
- As admin vs. non-admin, the highlight lands on the correct tab in both cases.

If the highlight is vertically off-center within the pill, tune the `highlight` rule's `top`/`bottom` insets in `style.ts` (currently `theme.space.xl`) — geometry-only, no behavior change.

- [ ] **Step 4: Reduced-motion check**

In DevTools, enable "Emulate prefers-reduced-motion: reduce". Confirm the highlight jumps (no slide) and tabs no longer scale on press.

---

## Self-Review

**Spec coverage:**
- Form factor (floating capsule, full pill) → Task 2 (`borderRadius: theme.radius.pill` on container). ✓
- Glass visual treatment (fill, blur+saturate, hairline, inner sheen, shadow) → Task 1 (`recipe.glass`, `shadow.glass`, `color.bg.glass`, `color.border.glass`) + Task 2 (spread into container). ✓
- Active highlight pill (single persistent, brand tint, full pill, hidden off-nav) → Task 2 (`highlight` rule) + Task 3 (`<span>` with `data-active`). ✓
- Motion: slide via `--active-index` transform + spring; press feedback → Task 1 (`transition.spring`), Task 2 (`highlight` transform/transition + item `&:active`), Task 3 (publishes `--active-index`). ✓
- Fallbacks: `@supports` opaque fill + `prefers-reduced-motion` → Task 1 (`recipe.glass` `@supports`) + Task 2 (reduced-motion blocks). ✓
- Enshrine all values in theme → Task 1 tokens/recipe; Task 1 test asserts `recipe.glass` references tokens. ✓
- Light-only / desktop untouched / no layout change → all visual changes inside `[theme.breakpoint.mobile]`; no page-style edits. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every step has concrete code or an exact command. ✓

**Type consistency:** `--active-index` (set in Task 3) is read by the `highlight` transform (Task 2); `data-active` attribute (Task 3) matches the `&[data-active="true"]` selector (Task 2); `MOBILE_ITEM_WIDTH` used consistently in `style.ts`; new `theme.*` token names in Task 1 match their references in Tasks 2 & 3. ✓
