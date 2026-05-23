# Theme Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client's mostly-unused `Theme` with one derived from values components actually render, then migrate every `style.ts` to consume the new theme so no component contains literal colors, sizes, shadows, transitions, or keyframes.

**Architecture:** Two layers. The first is primitive tokens (`color`, `space`, `radius`, `fontSize`, `fontWeight`, `shadow`, `transition`, `zIndex`). The second is recipes — JSS-spreadable objects for the highest-frequency patterns (`input`, `modal`, `card`, `label`, `spinner`, `focusRing`, `buttonStack`). Keyframes register once in a global stylesheet. Legacy theme paths (`theme.colors.*`, `theme.borderRadius.*`, etc.) remain as compatibility aliases through Phases 2–4 so the build never breaks; Phase 5 deletes them.

**Tech Stack:** React 18, TypeScript, react-jss (JSS via `createUseStyles`/`ThemeProvider`), Vitest

**Spec:** `docs/superpowers/specs/2026-05-20-theme-refactor-design.md` (commit `25e99e3`)

**Branch:** `feat/react-migration` (per `feedback_always_use_branch.md` — no commits to main; per `feedback_remote_name.md` — push to `GitHub` remote, not `origin`)

---

## File Map

**Modified (theme module):**
- `client/src/provider/theme/theme.ts` — full rewrite: new `Theme` interface, `defaultTheme` with tokens + recipes + legacy aliases
- `client/src/provider/theme/provider.tsx` — render `<GlobalStyles />` alongside children
- `client/src/provider/theme/provider.test.tsx` — assert new token shape
- `client/src/provider/theme/index.ts` — re-export the new global-styles hook

**Created (theme module):**
- `client/src/provider/theme/global-styles.ts` — global `body` styles + `@keyframes theme-rotation` + `@keyframes theme-slide-in`; exports `useThemeGlobalStyles()` and `<GlobalStyles />`

**Migrated (39 component style files):**

Controls (10):
- `client/src/control/text-input/style.ts`
- `client/src/control/text-area/style.ts`
- `client/src/control/number-input/style.ts`
- `client/src/control/switch/style.ts`
- `client/src/control/button/style.ts`
- `client/src/control/confirm-modal/style.ts`
- `client/src/control/set-progress-modal/style.ts`
- `client/src/control/delete-book-button/style.ts`
- `client/src/control/proportional-chapter-slider/style.ts`
- `client/src/control/field-list/style.ts`

Components (23):
- `client/src/component/card/style.ts`, `card-row/style.ts`, `collapsible-section/style.ts`
- `client/src/component/page/style.ts`, `header/style.ts`, `toast/style.ts`
- `client/src/component/cover/style.ts`, `cover-stack/style.ts`
- `client/src/component/metadata/style.ts`, `metadata-list/style.ts`, `tag/style.ts`
- `client/src/component/book-row/style.ts`, `series-row/style.ts`
- `client/src/component/upload-item/style.ts`, `upload-zone/style.ts`
- `client/src/component/user-row/style.ts`, `user-row-content/style.ts`, `user-progress-row/style.ts`, `user-list/style.ts`, `user-register/style.ts`
- `client/src/component/library-scan/style.ts`, `chapter-progress/style.ts`, `progress-indicator/style.ts`

Pages (6):
- `client/src/page/series/style.ts`, `library/style.ts`, `book/style.ts`, `book-edit/style.ts`, `login/style.ts`, `upload/style.ts`

---

## Conventions used in this plan

- **`theme.X` always refers to the NEW theme** (`theme.color.brand.default`, `theme.space.md`, etc.). The legacy paths (`theme.colors.primary`, `theme.text.size.md`) appear only when discussing what to migrate FROM.
- **Each migration task replaces the full file contents.** The "new file" code block is the literal content to write to disk.
- **Run order for verification** in every migration task: `npx tsc --noEmit` (from `client/`) → commit. Lint is deferred to the final task to avoid noise during the refactor.
- **Working directory** is `/Users/korzun/Code/HASS-ODPS` unless noted. Commands prefixed `cd client &&` run from the client subdirectory.

---

## Task 1: Define the new `Theme` interface and primitive tokens

**Files:**
- Modify: `client/src/provider/theme/theme.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Write the full new file:

```ts
import { applyTransparency } from '~/utils';

// ─── Primitive palettes ───
const gray = {
  50:  '#FAFAFA',
  100: '#EEEEEE',
  150: '#e5e7eb',
  200: '#DDDDDD',
  300: '#D9D9D9',
  400: '#D0D0D0',
  500: '#9ca3af',
  600: '#6E6E6E',
  700: '#5A6375',
  900: '#111',
} as const;

const blue = {
  50:  '#EFF6FF',
  100: '#dbeafe',
  200: '#91CAFF',
  300: '#87BAFF',
  400: '#3696fe',
  500: '#1777FF',
  600: '#1D4ED8',
  700: '#0758d9',
  800: '#083FBC',
} as const;

const red = {
  50:  '#fff1f0',
  100: '#FFA8A6',
  300: '#ff7874',
  400: '#FF8E8E',
  500: '#FF4D4F',
  600: '#e98182',
  700: '#D9373e',
} as const;

// ─── Theme interface ───
export interface Theme {
  color: {
    gray: typeof gray;
    blue: typeof blue;
    red:  typeof red;
    text:    { primary: string; secondary: string; muted: string; faint: string; onPrimary: string; onDanger: string };
    bg:      { page: string; card: string; cardHeader: string; input: string; footer: string };
    border:  { default: string; strong: string; light: string; focus: string; hover: string; danger: string };
    success: string;
    brand:   { default: string; hover: string; active: string; light: string; outline: string;
               loading: string; loadingHover: string; loadingActive: string };
    accent:  { default: string; hover: string };
    danger:  { default: string; hover: string; active: string; light: string; outline: string;
               loading: string; loadingHover: string; loadingActive: string };
    overlay: { backdrop: string };
  };
  space: {
    xxs: string; xs: string; sm: string; md: string; lg: string; xl: string;
    xxl: string; xxxl: string; xxxxl: string; xxxxxl: string;
  };
  radius:     { sm: string; md: string; lg: string; circle: string };
  fontSize:   { xs: string; sm: string; md: string; lg: string; xl: string; xxl: string };
  fontWeight: { medium: number; semibold: number; bold: number; extrabold: number };
  lineHeight: { tight: number; body: number };
  shadow:     { card: string; cardStack: string; hoverLift: string; dangerStack: string; brandStack: string };
  transition: { fast: string; slide: string; slow: string };
  zIndex: {
    behind: number; base: number;
    stack:  { lo: number; md: number; hi: number };
    header: number; sticky: number; toast: number;
  };

  // Recipes are JSS-spreadable fragments. The `Record<string, any>` shape lets them include
  // pseudo-selectors (`&:hover`) and nested rules without fighting JSS's TS surface.
  recipe: {
    input:     Record<string, any>;
    focusRing: Record<string, any>;
    label:     Record<string, any>;
    spinner:   Record<string, any>;
    modal: {
      dialog: Record<string, any>;
      header: Record<string, any>;
      footer: Record<string, any>;
    };
    card: {
      shell:  Record<string, any>;
      header: Record<string, any>;
    };
  };

  // ─── Legacy compatibility — Phase 5 deletes these ───
  colors: {
    primary: string; primaryHover: string; primaryLight: string; primaryBorder: string;
    danger: string; success: string;
    text: { primary: string; secondary: string; muted: string; faint: string };
    bg:   { page: string; card: string; input: string };
    border: string; borderLight: string;
  };
  borderRadius: { sm: string; md: string; lg: string; pill: string };
  shadows:      { card: string; cover: string };
  text:         { size: { sm: string; md: string; lg: string; xlg: string } };
}

// ─── Build defaults ───
function buildTheme(): Theme {
  const color: Theme['color'] = {
    gray, blue, red,
    text: {
      primary:   gray[900],
      secondary: gray[700],
      muted:     gray[600],
      faint:     gray[500],
      onPrimary: '#FFFFFF',
      onDanger:  '#FFFFFF',
    },
    bg: {
      page:       '#FFFFFF',
      card:       gray[50],
      cardHeader: gray[100],
      input:      '#FFFFFF',
      footer:     gray[100],
    },
    border: {
      default: gray[300],
      strong:  gray[200],
      light:   gray[150],
      focus:   blue[700],
      hover:   blue[200],
      danger:  red[500],
    },
    success: '#16a34a',
    brand: {
      default:       blue[500],
      hover:         blue[400],
      active:        blue[700],
      light:         blue[50],
      outline:       blue[200],
      loading:       '#73A6FF',
      loadingHover:  blue[300],
      loadingActive: '#6893e7',
    },
    accent: { default: blue[800], hover: blue[700] },
    danger: {
      default:       red[500],
      hover:         red[300],
      active:        red[700],
      light:         red[50],
      outline:       applyTransparency(red[300], 0.5),
      loading:       red[400],
      loadingHover:  red[100],
      loadingActive: red[600],
    },
    overlay: { backdrop: applyTransparency('#000', 0.7) },
  };

  const space: Theme['space'] = {
    xxs:    '0.125rem',
    xs:     '0.25rem',
    sm:     '0.375rem',
    md:     '0.5rem',
    lg:     '0.625rem',
    xl:     '0.75rem',
    xxl:    '1rem',
    xxxl:   '1.25rem',
    xxxxl:  '1.5rem',
    xxxxxl: '2rem',
  };

  const radius:     Theme['radius']     = { sm: '4px', md: '8px', lg: '16px', circle: '50%' };
  const fontSize:   Theme['fontSize']   = { xs: '0.7rem', sm: '0.75rem', md: '0.875rem', lg: '1rem', xl: '1.25rem', xxl: '1.75rem' };
  const fontWeight: Theme['fontWeight'] = { medium: 500, semibold: 600, bold: 700, extrabold: 800 };
  const lineHeight: Theme['lineHeight'] = { tight: 1, body: 1.3 };

  const shadow: Theme['shadow'] = {
    card:        '0 1px 3px rgba(0,0,0,0.07)',
    cardStack:   `0px 2px 0px ${applyTransparency('#D9D9D9', 0.2)}`,
    hoverLift:   '0 2px 8px rgba(0,0,0,0.15)',
    dangerStack: `0px 2px 0px ${applyTransparency('#FF4D4F', 0.1)}`,
    brandStack:  `0px 2px 0px ${applyTransparency('#1777FF', 0.2)}`,
  };

  const transition: Theme['transition'] = {
    fast:  '0.1s ease-in',
    slide: '0.2s ease-out',
    slow:  '0.3s linear',
  };

  const zIndex: Theme['zIndex'] = {
    behind: -1,
    base:   1,
    stack:  { lo: 1, md: 2, hi: 3 },
    header: 10,
    sticky: 1000,
    toast:  9999,
  };

  // Recipes filled in by Task 2; placeholder empty objects for now so the file type-checks.
  const recipe: Theme['recipe'] = {
    input:     {},
    focusRing: {},
    label:     {},
    spinner:   {},
    modal: { dialog: {}, header: {}, footer: {} },
    card:  { shell: {}, header: {} },
  };

  return {
    color, space, radius, fontSize, fontWeight, lineHeight,
    shadow, transition, zIndex, recipe,

    // Legacy compatibility — preserves rendered values so unmigrated components are unaffected.
    colors: {
      primary:       blue[800],            // matches old #083FBC
      primaryHover:  blue[600],            // matches old #1d4ed8
      primaryLight:  blue[50],             // matches old #eff6ff
      primaryBorder: '#bfdbfe',            // preserved as-is (unreferenced in code)
      danger:        red[500],
      success:       '#16a34a',
      text: {
        primary:   color.text.primary,
        secondary: color.text.secondary,
        muted:     color.text.muted,
        faint:     color.text.faint,
      },
      bg: {
        page:  color.bg.page,
        card:  color.bg.card,
        input: color.bg.input,
      },
      border:      color.border.default,
      borderLight: color.border.light,
    },
    borderRadius: { sm: '4px', md: '8px', lg: '16px', pill: '20px' },
    shadows:      { card: '0 1px 3px rgba(0,0,0,0.07)', cover: '0 2px 8px rgba(0,0,0,0.15)' },
    text:         { size: { sm: '10px', md: '12px', lg: '16px', xlg: '20px' } },
  };
}

export const defaultTheme: Theme = buildTheme();
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors. (Recipe values are empty objects — fine for now; spreading `{}` into a JSS rule is a no-op. Components still see all legacy paths, so nothing else breaks.)

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/theme/theme.ts
git commit -m "$(cat <<'EOF'
refactor(theme): rewrite Theme with primitive tokens

Introduce new structure (color/space/radius/fontSize/fontWeight/
shadow/transition/zIndex), derived from values components currently
render. Legacy paths (colors/borderRadius/shadows/text) preserved
as compatibility aliases through Phase 4 — Phase 5 removes them.
Recipes are stub objects, populated in the next task.
EOF
)"
```

---

## Task 2: Populate theme recipes

**Files:**
- Modify: `client/src/provider/theme/theme.ts` (replace the `recipe` const inside `buildTheme()`)

- [ ] **Step 1: Replace the `recipe` declaration**

Find this block inside `buildTheme()`:

```ts
  // Recipes filled in by Task 2; placeholder empty objects for now so the file type-checks.
  const recipe: Theme['recipe'] = {
    input:     {},
    focusRing: {},
    label:     {},
    spinner:   {},
    modal: { dialog: {}, header: {}, footer: {} },
    card:  { shell: {}, header: {} },
  };
```

Replace it with:

```ts
  const recipe: Theme['recipe'] = {
    input: {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: 'transparent',
      backgroundColor: color.bg.input,
      borderColor: color.border.default,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderRadius: radius.md,
      padding: space.md,
      '&:hover':  { borderColor: color.border.hover },
      '&:focus':  { borderColor: color.border.focus },
      '&$danger': { borderColor: color.border.danger },
    },
    focusRing: {
      outlineWidth: '2px',
      outlineStyle: 'solid',
      outlineColor: 'transparent',
    },
    label: {
      fontWeight: fontWeight.semibold,
      fontSize:   fontSize.md,
      color:      color.text.muted,
      display:    'block',
      '&$danger': { color: color.danger.default },
    },
    spinner: {
      animation: 'theme-rotation 1s infinite linear',
      height: '1em',
      width:  '1em',
    },
    modal: {
      dialog: {
        cursor: 'default',
        borderRadius: radius.lg,
        border: 'none',
        marginTop:    '100px',
        marginLeft:   'auto',
        marginRight:  'auto',
        marginBottom: '50px',
        outline: 'none',
        '&::backdrop': {
          backgroundColor: color.overlay.backdrop,
          backdropFilter:  'blur(2px) saturate(0%)',
        },
      },
      header: {
        fontWeight: fontWeight.semibold,
        fontSize:   fontSize.xl,
        padding:    space.xxl,
      },
      footer: {
        backgroundColor:   color.bg.footer,
        borderTopStyle:    'solid',
        borderTopColor:    color.border.strong,
        borderTopWidth:    '1px',
        display:           'flex',
        flexDirection:     'row',
        justifyContent:    'end',
        gap:               space.md,
        paddingTop:        space.xl,
        paddingBottom:     space.xl,
        paddingLeft:       space.xl,
        paddingRight:      space.xl,
      },
    },
    card: {
      shell: {
        backgroundColor: color.bg.card,
        borderRadius:    radius.lg,
        borderStyle:     'solid',
        borderWidth:     '1px',
        borderColor:     color.border.strong,
        overflow:        'hidden',
        boxShadow:       shadow.cardStack,
      },
      header: {
        display:           'flex',
        alignItems:        'baseline',
        justifyContent:    'space-between',
        padding:           `${space.md} ${space.xl}`,
        backgroundColor:   color.bg.cardHeader,
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderBottomColor: color.border.strong,
        userSelect:        'none',
        '-webkit-user-select': 'none',
      },
    },
  };
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/theme/theme.ts
git commit -m "$(cat <<'EOF'
refactor(theme): add recipes for input/modal/card/label/spinner

Each recipe is a JSS-spreadable fragment that captures patterns
duplicated across components (form-input frame, modal frame,
card shell, form-field label, rotating spinner, focus ring,
"raised" button shadow).
EOF
)"
```

---

## Task 3: Create the global stylesheet hook

**Files:**
- Create: `client/src/provider/theme/global-styles.ts`
- Modify: `client/src/provider/theme/index.ts`

- [ ] **Step 1: Create `global-styles.ts`**

```ts
import { createUseStyles } from 'react-jss';

import type { Theme } from './theme';

const useGlobalStyles = createUseStyles((theme: Theme) => ({
  '@global': {
    body: {
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: theme.color.bg.page,
      color: theme.color.text.primary,
      minHeight: '100vh',
    },
    'body:has(dialog[open])': {
      overflow: 'hidden',
    },
    '@keyframes theme-rotation': {
      '0%':   { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(360deg)' },
    },
    '@keyframes theme-slide-in': {
      from: { opacity: 0, transform: 'translateY(0.4rem)' },
      to:   { opacity: 1, transform: 'translateY(0)' },
    },
  },
}));

export function useThemeGlobalStyles() {
  useGlobalStyles();
}

export function GlobalStyles() {
  useThemeGlobalStyles();
  return null;
}
```

The `body:has(dialog[open])` rule moves out of `confirm-modal/style.ts` and `set-progress-modal/style.ts` (those `@global` declarations are removed in Tasks 11–12). Keyframes are named with a `theme-` prefix so component code can reference them without `$rotation` (which only works for in-sheet keyframes).

- [ ] **Step 2: Update `index.ts`**

Replace `client/src/provider/theme/index.ts` with:

```ts
export { createUseStyles } from 'react-jss';

export { ThemeProvider } from './provider';
export { useTheme } from './use-theme';
export { GlobalStyles, useThemeGlobalStyles } from './global-styles';
export type { Theme } from './theme';
```

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/provider/theme/global-styles.ts client/src/provider/theme/index.ts
git commit -m "$(cat <<'EOF'
feat(theme): add GlobalStyles for body + theme keyframes

Centralize the body font + background, the dialog-open scroll
lock, and the two animation keyframes (theme-rotation,
theme-slide-in) so components stop redeclaring them.
EOF
)"
```

---

## Task 4: Wire `<GlobalStyles />` into the ThemeProvider

**Files:**
- Modify: `client/src/provider/theme/provider.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import type { ReactNode } from 'react';
import { ThemeProvider as JssThemeProvider } from 'react-jss';

import { GlobalStyles } from './global-styles';
import { defaultTheme } from './theme';

export type ThemeProviderProps = { children: ReactNode };
export const ThemeProvider = ({ children }: ThemeProviderProps) => (
  <JssThemeProvider theme={defaultTheme}>
    <GlobalStyles />
    {children}
  </JssThemeProvider>
);
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/theme/provider.tsx
git commit -m "refactor(theme): mount GlobalStyles inside ThemeProvider"
```

---

## Task 5: Rewrite the theme-provider test

**Files:**
- Modify: `client/src/provider/theme/provider.test.tsx`

The current test asserts old paths with values that don't match the actual stored theme (e.g. expects `theme.colors.primary === '#1e40af'` while the value is `'#083FBC'`). Rewrite to read from the new structure.

- [ ] **Step 1: Replace the file contents**

```tsx
import { render, screen } from '@testing-library/react';

import { ThemeProvider } from './provider';
import { useTheme } from './use-theme';

function TokenDisplay() {
  const theme = useTheme();
  return (
    <div>
      <span data-testid="brand-default">{theme.color.brand.default}</span>
      <span data-testid="accent-default">{theme.color.accent.default}</span>
      <span data-testid="danger-default">{theme.color.danger.default}</span>
      <span data-testid="success">{theme.color.success}</span>
      <span data-testid="space-md">{theme.space.md}</span>
      <span data-testid="radius-md">{theme.radius.md}</span>
      <span data-testid="font-size-md">{theme.fontSize.md}</span>
      <span data-testid="shadow-card">{theme.shadow.card}</span>
      <span data-testid="transition-fast">{theme.transition.fast}</span>
    </div>
  );
}

it('provides theme tokens to children', () => {
  render(
    <ThemeProvider>
      <TokenDisplay />
    </ThemeProvider>
  );
  expect(screen.getByTestId('brand-default').textContent).toBe('#1777FF');
  expect(screen.getByTestId('accent-default').textContent).toBe('#083FBC');
  expect(screen.getByTestId('danger-default').textContent).toBe('#FF4D4F');
  expect(screen.getByTestId('success').textContent).toBe('#16a34a');
  expect(screen.getByTestId('space-md').textContent).toBe('0.5rem');
  expect(screen.getByTestId('radius-md').textContent).toBe('8px');
  expect(screen.getByTestId('font-size-md').textContent).toBe('0.875rem');
  expect(screen.getByTestId('shadow-card').textContent).toBe('0 1px 3px rgba(0,0,0,0.07)');
  expect(screen.getByTestId('transition-fast').textContent).toBe('0.1s ease-in');
});
```

- [ ] **Step 2: Run the test**

```bash
cd client && npx vitest run src/provider/theme/provider.test.tsx
```

Expected: 1 test passing. If the local `node_modules` is broken (`Cannot find module @rollup/rollup-darwin-arm64`), reinstall with `cd client && rm -rf node_modules package-lock.json && npm install`, then re-run.

- [ ] **Step 3: Commit**

```bash
git add client/src/provider/theme/provider.test.tsx
git commit -m "test(theme): assert new token structure"
```

---

## Task 6: Phase 1 end-to-end verification

**Files:** none

- [ ] **Step 1: Type-check the whole client**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors. (Every component still uses legacy paths, which now route through compatibility aliases pointing at the new values — the rendering is unchanged from `main`.)

- [ ] **Step 2: Run the test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Start dev server and visually confirm fidelity**

```bash
cd client && npx vite
```

In a browser at the printed URL, navigate to a few pages (library, book detail, login). The rendering should be identical to `main` since no component has been migrated yet. Stop the server (Ctrl-C) once confirmed.

- [ ] **Step 4: Commit (verification only — no file changes)**

If steps 1–3 all pass, this task has no commit. If any failed, debug and add fixes as their own task before continuing.

---

## Task 7: Migrate form-input controls (text-input, text-area, number-input)

These three share `recipe.input`. Migrate together so the recipe is exercised against every consumer at once.

**Files:**
- Modify: `client/src/control/text-input/style.ts`
- Modify: `client/src/control/text-area/style.ts`
- Modify: `client/src/control/number-input/style.ts`

- [ ] **Step 1: Replace `text-input/style.ts`**

```ts
import { createUseStyles, Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    '&$horizontal': {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'start',
      gap: theme.space.md,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.md,
        marginLeft: theme.space.sm,
        minWidth: '6rem',
        textAlign: 'right',
      },
      '& $input': { flexGrow: 1 },
    },
    '&$vertical': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.xs,
        marginLeft: theme.space.md,
      },
      '& $input': { flexGrow: 1 },
    },
    '&$inline': {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: theme.space.md,
    },
  },
  label: {
    ...theme.recipe.label,
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'row',
    flexGrow: 1,
    alignItems: 'center',
    position: 'relative',
  },
  input: {
    ...theme.recipe.input,
    flexGrow: 1,
    zIndex: theme.zIndex.base,
    '&$isAction': { paddingRight: theme.space.xxxxxl },
  },
  action: {
    paddingBottom: '2px',
    paddingTop: '6px',
    position: 'absolute',
    right: theme.space.md,
    zIndex: theme.zIndex.base,
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
  isAction: {},
}));
```

Notes:
- The `0.2rem` gap in the original vertical layout maps to `space.xs` (0.25rem) per the spec's small-consolidation policy.
- `2rem` paddingRight maps to `space.xxxxxl`.
- The `padding*` on `action` (2px, 6px) are sub-pixel optical-centering tweaks — they stay literal per spec §"What stays bespoke (intentionally)".
- `recipe.input` already supplies the `&$danger` rule, so the local `danger: {}` reference is unchanged but no danger-specific declarations are needed here.

- [ ] **Step 2: Replace `text-area/style.ts`**

```ts
import { createUseStyles, Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    '&$horizontal': {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'start',
      gap: theme.space.md,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.md,
        marginLeft: theme.space.sm,
        minWidth: '6rem',
        textAlign: 'right',
      },
      '& $input': { flexGrow: 1 },
    },
    '&$vertical': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.xs,
        marginLeft: theme.space.md,
      },
      '& $input': { flexGrow: 1 },
    },
    '&$inline': {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: theme.space.md,
    },
  },
  label: {
    ...theme.recipe.label,
  },
  input: {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: 'transparent',
    padding: theme.space.md,
    resize: 'none',
    minHeight: '10rem',
    '&$outlined': {
      ...theme.recipe.input,
    },
    '&$borderless': {
      borderStyle: 'none',
      borderRadius: theme.radius.md,
    },
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
  outlined: {},
  borderless: {},
}));
```

Note: `text-area`'s `input` is structurally different from `text-input`'s — it lives inside a `&$outlined` modifier. Spreading `recipe.input` under `&$outlined` gives the same default/hover/focus/danger frame.

- [ ] **Step 3: Replace `number-input/style.ts`**

```ts
import { createUseStyles, Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    '&$horizontal': {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'start',
      gap: theme.space.md,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.md,
        marginLeft: theme.space.sm,
        minWidth: '6rem',
        textAlign: 'right',
      },
      '& $input': { flexGrow: 1 },
    },
    '&$vertical': {
      display: 'flex',
      flexDirection: 'column',
      gap: theme.space.xs,
      backgroundColor: theme.color.bg.cardHeader,
      '& $label': {
        marginTop: theme.space.xs,
        marginLeft: theme.space.md,
      },
      '& $input': { flexGrow: 1 },
    },
    '&$inline': {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: theme.space.md,
    },
  },
  label: {
    ...theme.recipe.label,
  },
  input: {
    ...theme.recipe.input,
  },
  danger: {},
  horizontal: {},
  vertical: {},
  inline: {},
}));
```

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/control/text-input/style.ts client/src/control/text-area/style.ts client/src/control/number-input/style.ts
git commit -m "$(cat <<'EOF'
refactor(controls): migrate form inputs to theme recipes

text-input, text-area, number-input now spread recipe.input and
recipe.label rather than redeclaring the input frame and label
styling. Spacing, radii, and colors reference theme tokens.
EOF
)"
```

---

## Task 8: Migrate the switch control

**Files:**
- Modify: `client/src/control/switch/style.ts`

- [ ] **Step 1: Replace the file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.space.md,
    cursor: 'pointer',
    userSelect: 'none',
    '-webkit-user-select': 'none',
  },
  track: {
    position: 'relative',
    width: '28px',
    height: '16px',
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.border.default,
    ...theme.recipe.focusRing,
    transitionProperty: 'background-color, outline-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$root:hover &': { outlineColor: theme.color.brand.outline },
    '$root:focus &': { outlineColor: theme.color.brand.outline },
    '&$checked':    { backgroundColor: theme.color.brand.default },
    '&$disabled':   { opacity: 0.4, cursor: 'not-allowed' },
  },
  thumb: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '12px',
    height: '12px',
    borderRadius: theme.radius.circle,
    backgroundColor: '#FFFFFF',
    transitionProperty: 'left',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '$checked &': { left: '14px' },
  },
  label: {
    ...theme.recipe.label,
  },
  checked: {},
  disabled: {},
}));
```

Notes:
- `width: 28px`, `height: 16px`, `top: 2px`, `left: 2px`, `width: 12px`, `height: 12px`, `left: 14px` are geometry-of-the-switch — they stay literal per spec §"What stays bespoke".
- The transition timing is left in expanded long-form because JSS interprets the shorthand `transition: '0.1s ease-in'` differently for multi-property cases; the long form matches the original behavior exactly.

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/control/switch/style.ts
git commit -m "refactor(switch): consume theme tokens + recipe.label/focusRing"
```

---

## Task 9: Migrate the button control

The button is the largest single migration: 5 type blocks × hover/focus/active/loading/disabled/danger state matrix. The structure stays; only values change.

**Files:**
- Modify: `client/src/control/button/style.ts`

- [ ] **Step 1: Replace the file**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export type ButtonTypeValue = 'default' | 'primary' | 'text' | 'link' | 'dashed';
export enum ButtonType {
  Default = 'default',
  Primary = 'primary',
  Text    = 'text',
  Link    = 'link',
  Dashed  = 'dashed',
}

export type StyleProps = {
  type: ButtonType;
};

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    gap: '0.5em',
    justifyContent: 'center',
    alignItems: 'center',
    color: theme.color.gray[900],
    ...theme.recipe.focusRing,
    borderColor: 'transparent',
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: theme.radius.md,
    padding: `${theme.space.md} ${theme.space.xxl}`,
    cursor: 'pointer',
    fontSize: '0.80rem', // button-specific size; not on the global fontSize scale
    userSelect: 'none',
    '-webkit-user-select': 'none',
    transitionProperty: 'color, background-color',
    transitionDuration: '0.1s',
    transitionTimingFunction: 'ease-in',
    '&:hover, &:focus, &:active': { transitionDuration: '0s' },
  },

  [ButtonType.Default]: {
    backgroundColor: theme.color.bg.input,
    borderColor: theme.color.border.default,
    borderStyle: 'solid',
    borderWidth: '1px',
    boxShadow: theme.shadow.cardStack,
    color: theme.color.gray[900],
    '&:focus': {
      borderColor: '#FFF',
      outlineColor: theme.color.brand.outline,
      boxShadow: `0px 2px 0px transparent`,
    },
    '&:hover': {
      borderColor: theme.color.brand.hover,
      color:       theme.color.brand.hover,
      outlineColor: 'transparent',
    },
    '&:active': {
      borderColor: theme.color.brand.active,
      color:       theme.color.brand.active,
    },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': {
        borderColor: theme.color.border.default,
        color:       theme.color.gray[900],
        outlineColor: 'transparent',
      },
    },
    '&$loading': {
      cursor: 'default',
      borderColor: '#e6e6e6',
      color:       theme.color.text.muted,
      boxShadow: `0px 2px 0px transparent`,
      outlineColor: 'transparent',
      '&:focus':  { borderColor: '#e6e6e6', color: theme.color.text.muted },
      '&:hover':  { borderColor: theme.color.blue[300], color: theme.color.blue[300] },
      '&:active': { borderColor: theme.color.brand.loadingActive, color: theme.color.brand.loadingActive },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
    '&$danger': {
      color:       theme.color.danger.default,
      borderColor: theme.color.danger.default,
      boxShadow:   theme.shadow.dangerStack,
      '&:focus': {
        color:        theme.color.danger.hover,
        borderColor:  '#FFF',
        outlineColor: theme.color.danger.outline,
        boxShadow:    `0px 2px 0px transparent`,
      },
      '&:hover': {
        color:        applyTransparency(theme.color.danger.hover, 0.67),
        borderColor:  applyTransparency(theme.color.danger.hover, 0.67),
        outlineColor: 'transparent',
      },
      '&:active': {
        color:        theme.color.danger.active,
        borderColor:  theme.color.danger.active,
      },
      '&$loading': {
        cursor: 'default',
        borderColor: theme.color.danger.hover,
        color:       theme.color.danger.hover,
        outlineColor: 'transparent',
        boxShadow:    `0px 2px 0px transparent`,
        '&:focus':  { borderColor: theme.color.danger.hover, color: theme.color.danger.hover },
        '&:hover':  { borderColor: theme.color.danger.loadingHover, color: theme.color.danger.loadingHover },
        '&:active': { borderColor: theme.color.danger.loadingActive, color: theme.color.danger.loadingActive },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
  },

  [ButtonType.Dashed]: {
    backgroundColor: theme.color.bg.input,
    borderColor: theme.color.border.default,
    borderStyle: 'dashed',
    borderWidth: '1px',
    color: theme.color.gray[900],
    '&:focus': {
      borderColor:  '#FFF',
      outlineColor: theme.color.brand.outline,
    },
    '&:hover': {
      borderColor:  theme.color.brand.hover,
      color:        theme.color.brand.hover,
      outlineColor: 'transparent',
    },
    '&:active': {
      borderColor: theme.color.brand.active,
      color:       theme.color.brand.active,
    },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': {
        borderColor: theme.color.border.default,
        color:       theme.color.gray[900],
        outlineColor: 'transparent',
      },
    },
    '&$loading': {
      cursor: 'default',
      borderColor: '#e6e6e6',
      color:       theme.color.text.muted,
      outlineColor: 'transparent',
      '&:focus':  { borderColor: '#e6e6e6', color: theme.color.text.muted },
      '&:hover':  { borderColor: theme.color.blue[300], color: theme.color.blue[300] },
      '&:active': { borderColor: theme.color.brand.loadingActive, color: theme.color.brand.loadingActive },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
    '&$danger': {
      color:       theme.color.danger.default,
      borderColor: theme.color.danger.default,
      '&:focus': {
        color:        theme.color.danger.hover,
        borderColor:  '#FFF',
        outlineColor: theme.color.danger.outline,
      },
      '&:hover': {
        color:        applyTransparency(theme.color.danger.hover, 0.67),
        borderColor:  applyTransparency(theme.color.danger.hover, 0.67),
        outlineColor: 'transparent',
      },
      '&:active': {
        color:        theme.color.danger.active,
        borderColor:  theme.color.danger.active,
      },
      '&$loading': {
        cursor: 'default',
        borderColor: theme.color.danger.hover,
        color:       theme.color.danger.hover,
        outlineColor: 'transparent',
        '&:focus':  { borderColor: theme.color.danger.hover, color: theme.color.danger.hover },
        '&:hover':  { borderColor: theme.color.danger.loadingHover, color: theme.color.danger.loadingHover },
        '&:active': { borderColor: theme.color.danger.loadingActive, color: theme.color.danger.loadingActive },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
  },

  [ButtonType.Primary]: {
    backgroundColor: theme.color.brand.default,
    boxShadow:       theme.shadow.brandStack,
    color:           theme.color.text.onPrimary,
    '&:focus': {
      backgroundColor: theme.color.brand.hover,
      borderColor:     '#FFFFFF',
      outlineColor:    applyTransparency(theme.color.brand.hover, 0.5),
      boxShadow:       `0px 2px 0px transparent`,
    },
    '&:hover': {
      backgroundColor: theme.color.brand.hover,
      outlineColor:    'transparent',
      borderColor:     'transparent',
    },
    '&:active': {
      backgroundColor: theme.color.brand.active,
      outlineColor:    'transparent',
      borderColor:     'transparent',
    },
    '&$loading': {
      cursor: 'default',
      backgroundColor: theme.color.brand.loading,
      boxShadow:       `0px 2px 0px transparent`,
      '&:focus':  { outlineColor: 'transparent', borderColor: 'transparent' },
      '&:hover':  { backgroundColor: theme.color.brand.loadingHover, outlineColor: 'transparent' },
      '&:active': { backgroundColor: theme.color.brand.loadingActive },
    },
    '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    '&$danger': {
      backgroundColor: theme.color.danger.default,
      boxShadow:       theme.shadow.dangerStack,
      '&:focus': {
        backgroundColor: theme.color.danger.hover,
        borderColor:     '#FFFFFF',
        outlineColor:    theme.color.danger.outline,
        boxShadow:       `0px 2px 0px transparent`,
      },
      '&:hover': {
        backgroundColor: theme.color.danger.hover,
        outlineColor:    'transparent',
        borderColor:     'transparent',
      },
      '&:active': {
        backgroundColor: theme.color.danger.active,
        outlineColor:    'transparent',
        borderColor:     'transparent',
      },
      '&$loading': {
        cursor: 'default',
        backgroundColor: theme.color.danger.loading,
        boxShadow:       `0px 2px 0px transparent`,
        '&:hover':  { backgroundColor: theme.color.danger.loadingHover, outlineColor: 'transparent' },
        '&:active': { backgroundColor: theme.color.danger.loadingActive },
        '&:focus':  { outlineColor: 'transparent' },
      },
      '&$disabled': { cursor: 'not-allowed', filter: 'saturate(0)' },
    },
  },

  [ButtonType.Text]: {
    cursor: 'pointer',
    '&:hover':  { backgroundColor: '#f0f0f0' },
    '&:active': { backgroundColor: theme.color.border.default },
    '&$disabled': {
      cursor: 'not-allowed',
      filter: 'saturate(0)',
      '&:hover': { backgroundColor: 'transparent' },
    },
    '&$loading': {
      cursor: 'default',
      color: theme.color.text.muted,
      '&:hover': { backgroundColor: '#f0f0f0' },
    },
    '&$danger': {
      color: theme.color.danger.default,
      '&:hover': { backgroundColor: theme.color.danger.light },
      '&$loading': {
        cursor: 'default',
        color: theme.color.danger.hover,
        '&:hover': { backgroundColor: theme.color.danger.light },
      },
    },
  },

  [ButtonType.Link]: {
    cursor: 'pointer',
    display: 'inline',
    borderStyle: 'none',
    outlineStyle: 'none',
    padding: '0',
    color: theme.color.brand.default,
    '&:hover':  { color: theme.color.brand.hover },
    '&:active': { color: theme.color.brand.active },
    '&$disabled': {
      cursor: 'default',
      color: theme.color.text.muted,
    },
    '&$loading': {
      cursor: 'default',
      color: theme.color.text.muted,
      '&:hover':  { color: theme.color.blue[300] },
      '&:active': { color: theme.color.brand.loadingActive },
    },
    '&$danger': {
      color: theme.color.danger.default,
      '&:hover':  { color: theme.color.danger.hover },
      '&:active': { color: theme.color.danger.active },
      '&$loading': {
        cursor: 'default',
        color: theme.color.danger.loading,
        '&:hover':  { color: theme.color.danger.loadingHover },
        '&:active': { color: theme.color.danger.loadingActive },
      },
    },
  },

  danger: {},
  disabled: { opacity: 0.5 },
  loading: {},
  spinner: {
    ...theme.recipe.spinner,
  },
}));
```

Notes:
- The local `@keyframes rotation` block is removed — `recipe.spinner` references the global `theme-rotation` defined in `global-styles.ts`.
- `#e6e6e6` and `#f0f0f0` stay as literals (one-off loading/text-button shades not worth their own slot).
- `0.80rem` button font-size stays literal — it's button-specific and doesn't match any global `fontSize.*` step.

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Run the button test if one exists**

```bash
cd client && npx vitest run src/control/button
```

Expected: pass (or "no tests found" if no test file).

- [ ] **Step 4: Commit**

```bash
git add client/src/control/button/style.ts
git commit -m "$(cat <<'EOF'
refactor(button): consume theme tokens for full state matrix

State structure unchanged. Colors, padding, radii, shadow, and
the rotation keyframe now resolve through the theme. Loading,
danger, and disabled variants use the brand and danger semantic
aliases; the local @keyframes rotation is removed (now global).
EOF
)"
```

---

## Task 10: Migrate modal controls (confirm-modal, set-progress-modal)

Both share `recipe.modal.{dialog,header,footer}`.

**Files:**
- Modify: `client/src/control/confirm-modal/style.ts`
- Modify: `client/src/control/set-progress-modal/style.ts`

- [ ] **Step 1: Replace `confirm-modal/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: '500px',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  icon: {
    height: '24px',
    display: 'inline',
    paddingRight: theme.space.md,
    '& svg': { position: 'relative', top: '5px' },
  },
  iconDanger: {
    color: theme.color.danger.default,
  },
  body: {
    paddingLeft:   theme.space.xxl,
    paddingRight:  theme.space.xxl,
    paddingBottom: theme.space.xxxxl,
    color: theme.color.text.secondary,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
```

Note: the `@global` body-scroll-lock block is removed — it now lives in `global-styles.ts`.

- [ ] **Step 2: Replace `set-progress-modal/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    width: '600px',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  chapterDisplay: {
    textAlign: 'center',
    padding: `${theme.space.md} ${theme.space.xxl}`,
  },
  chapterNumber: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
  },
  chapterNumberMuted: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.faint,
  },
  chapterName: {
    fontSize: theme.fontSize.sm,
    fontStyle: 'italic',
    color: theme.color.text.muted,
    marginTop: theme.space.xxs,
    minHeight: '1.25em',
  },
  chapterSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginTop: theme.space.xxs,
  },
  sliderSection: {
    padding: `${theme.space.xl} ${theme.space.xxl} ${theme.space.xxxxl}`,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    padding: `0 ${theme.space.xxl} ${theme.space.xl}`,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
```

Notes:
- The `0.85rem` (`chapterName`) and `0.8rem` (`chapterSubtitle`, `error`) literals round to `fontSize.sm` (0.75rem) per spec.
- Body-scroll-lock removed (now global).

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/control/confirm-modal/style.ts client/src/control/set-progress-modal/style.ts
git commit -m "refactor(modals): consume recipe.modal for dialog/header/footer"
```

---

## Task 11: Migrate the remaining small controls

**Files:**
- Modify: `client/src/control/delete-book-button/style.ts`
- Modify: `client/src/control/proportional-chapter-slider/style.ts`
- Modify: `client/src/control/field-list/style.ts`

- [ ] **Step 1: Replace `delete-book-button/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  book: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
  },
  undone: {
    fontWeight: theme.fontWeight.extrabold,
  },
}));
```

- [ ] **Step 2: Replace `proportional-chapter-slider/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'relative',
    height: '40px',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
  },
  track: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: '4px',
    background: theme.color.border.light,
    borderRadius: '2px', // slider-tick geometry — stays literal
    transform: 'translateY(-50%)',
  },
  fill: {
    position: 'absolute',
    top: '50%',
    left: 0,
    height: '4px',
    background: theme.color.accent.default,
    borderRadius: '2px',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
  tick: {
    position: 'absolute',
    top: '50%',
    width: '2px',
    height: '14px',
    background: theme.color.border.light,
    transform: 'translate(-50%, -50%)',
    borderRadius: '1px',
    pointerEvents: 'none',
  },
  tickActive: {
    background: theme.color.accent.default,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: '18px',
    height: '18px',
    background: theme.color.accent.default,
    borderRadius: theme.radius.circle,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,.2)', // slider-thumb-specific shadow
  },
  thumbDisabled: {
    background: theme.color.text.faint,
    cursor: 'not-allowed',
  },
  labels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xs,
  },
}));
```

- [ ] **Step 3: Replace `field-list/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xl,
  },
  rowContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xs,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  field: {
    flexGrow: 1,
  },
}));
```

Notes:
- `field-list` had `gap: '12px'` at the root; that maps to `space.xl` (0.75rem = 12px ✓ exact).
- `gap: '4px'` on the row maps to `space.xs` (0.25rem = 4px ✓ exact).
- `gap: '0.2rem'` on rowContainer maps to `space.xs` (0.25rem) per the small-consolidation policy.

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add client/src/control/delete-book-button/style.ts client/src/control/proportional-chapter-slider/style.ts client/src/control/field-list/style.ts
git commit -m "refactor(controls): migrate slider, field-list, delete-book-button"
```

---

## Task 12: Migrate card family (card, card-row, collapsible-section)

These share `recipe.card.shell` and `recipe.card.header`.

**Files:**
- Modify: `client/src/component/card/style.ts`
- Modify: `client/src/component/card-row/style.ts`
- Modify: `client/src/component/collapsible-section/style.ts`

- [ ] **Step 1: Replace `card/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.card.shell,
  },
  header: {
    ...theme.recipe.card.header,
    '&$danger':    { color: theme.color.danger.default },
    '&$collapsed': { borderBottomStyle: 'none' },
  },
  title: {
    fontWeight: theme.fontWeight.semibold,
    fontSize:   theme.fontSize.md,
    color:      theme.color.text.muted,
  },
  subTitle: {
    fontSize:   theme.fontSize.xs,
    color:      theme.color.text.faint,
    marginLeft: theme.space.xs,
  },
  spacer: { flexGrow: 1 },
  content: { padding: theme.space.xl },
  clickable: { cursor: 'pointer' },
  collapsed: {},
  danger: {},
}));
```

- [ ] **Step 2: Read & replace `card-row/style.ts`**

First open the file to confirm the structure, then write the new version. Read it via:

```bash
cat client/src/component/card-row/style.ts
```

Apply the following transformation:
- `backgroundColor: '#FAFAFA'` → `theme.color.bg.card`
- `borderRadius: '10px'` → keep literal (10px is unique; one-off radius for this row) OR if it matches `radius.md` visually after testing, swap to `theme.radius.md`. **Default: keep `'10px'` literal and add comment `// row-specific 10px radius`.**
- `borderColor: '#DDDDDD'` → `theme.color.border.strong`
- Any `boxShadow` with `applyTransparency('#D9D9D9', ...)` → `theme.shadow.cardStack`
- Spacing/padding literals → `theme.space.*`

Apply the same conventions and commit the resulting file.

- [ ] **Step 3: Replace `collapsible-section/style.ts`**

Read the current file:

```bash
cat client/src/component/collapsible-section/style.ts
```

Then rewrite using:
- `backgroundColor: '#FAFAFA'` → `theme.color.bg.card`
- `borderColor: '#DDDDDD'` → `theme.color.border.strong`
- `backgroundColor: '#EEEEEE'` (header bg) → `theme.color.bg.cardHeader`
- `theme.shadows.card` → `theme.shadow.card`
- `color: '#6E6E6E'` → `theme.color.text.muted`
- `color: '#FF4D4F'` (danger) → `theme.color.danger.default`
- All `padding`/`margin`/`gap` literals → `theme.space.*`
- All `fontSize` literals → `theme.fontSize.*`
- All `fontWeight: 600` → `theme.fontWeight.semibold`

Where the file declares a card-like outer container plus a header strip, replace those rules with `...theme.recipe.card.shell` and `...theme.recipe.card.header` respectively, then add only the section-specific overrides.

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add client/src/component/card/style.ts client/src/component/card-row/style.ts client/src/component/collapsible-section/style.ts
git commit -m "refactor(card): consume recipe.card.shell + recipe.card.header"
```

---

## Task 13: Migrate page, header, toast

**Files:**
- Modify: `client/src/component/page/style.ts`
- Modify: `client/src/component/header/style.ts`
- Modify: `client/src/component/toast/style.ts`

- [ ] **Step 1: Replace `page/style.ts`**

The body-styling `@global` block moves out (it now lives in `global-styles.ts`). The remaining rules:

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export type PageTypeValue = 'default' | 'minimal';
export enum PageType {
  default = 'default',
  minimal = 'minimal',
}

export const useStyle = createUseStyles((theme: Theme) => ({
  [PageType.default]: {
    maxWidth: 800,
    margin: `${theme.space.xxxxxl} auto`,
    padding: `0 ${theme.space.xxl}`,
    display: 'flex',
    gap: theme.fontSize.md, // historical: 0.875rem flexbox gap
    flexDirection: 'column',
  },
  [PageType.minimal]: {},
  noise: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0.2,
    pointerEvents: 'none',
    zIndex: theme.zIndex.behind,
  },
}));
```

Note: `gap: '0.875rem'` is the body font-size used as a flex-gap value — preserve by referencing `theme.fontSize.md`.

- [ ] **Step 2: Read & replace `header/style.ts`**

```bash
cat client/src/component/header/style.ts
```

Apply:
- `backgroundColor: theme.colors.bg.page` → `theme.color.bg.page`
- Any `#111111`, `#111111FF`, `#11111177` → `theme.color.gray[900]` (with `applyTransparency(...)` for the alpha variants)
- All `padding`/`gap`/`margin` → `theme.space.*`
- `fontSize`/`fontWeight` literals → tokens
- `zIndex: 10` → `theme.zIndex.header`, `zIndex: 1000` → `theme.zIndex.sticky`, `zIndex: -1` → `theme.zIndex.behind`
- `transitionProperty: color, border-bottom-color, transitionDuration: 0.1s, transitionTimingFunction: ease-in` — keep expanded form; use `theme.transition.fast` value semantically by extracting `0.1s` + `ease-in` from `theme.transition.fast` if convenient, otherwise keep literal `'0.1s'` + `'ease-in'`. The `transitionProperty` stays a literal list.
- Icon `15px` sizing stays literal (icon geometry).

- [ ] **Step 3: Replace `toast/style.ts`**

```ts
import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'fixed',
    bottom: theme.space.xxl,
    right: theme.space.xxl,
    background: theme.color.bg.card,
    boxShadow: theme.shadow.hoverLift,
    borderRadius: theme.radius.md,
    padding: `${theme.space.md} ${theme.space.xl}`,
    zIndex: theme.zIndex.toast,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    animation: `theme-slide-in ${theme.transition.slide}`,
  },
  iconSuccess: { display: 'flex', color: theme.color.success },
}));
```

**Confirm** the bottom/right offsets by reading the current file first — `cat client/src/component/toast/style.ts`. Adjust if the original used different values; preserve them via the appropriate `space.*` token.

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add client/src/component/page/style.ts client/src/component/header/style.ts client/src/component/toast/style.ts
git commit -m "refactor(layout): migrate page/header/toast to theme tokens"
```

---

## Task 14: Migrate cover family (cover, cover-stack)

**Files:**
- Modify: `client/src/component/cover/style.ts`
- Modify: `client/src/component/cover-stack/style.ts`

- [ ] **Step 1: Read & replace `cover/style.ts`**

```bash
cat client/src/component/cover/style.ts
```

Apply:
- `borderRadius` literals → `theme.radius.md` (most likely 8px)
- Any `boxShadow` literal — if it's `'0 2px 8px rgba(0,0,0,.15)'` → `theme.shadow.hoverLift`; otherwise keep literal and add a comment
- The dynamic `boxShadow: ({sequence, isGhost}) => ...` callback stays — it still uses `applyTransparency()` for per-card opacity, which is the documented exception in the spec.

- [ ] **Step 2: Read & replace `cover-stack/style.ts`**

```bash
cat client/src/component/cover-stack/style.ts
```

Apply:
- `marginLeft: '-12px'` / `'-15px'` → keep literal (overlap-layout, per spec)
- `width: '4px'` → keep literal (geometry)
- `borderRadius: 2` (placeholder corners) → keep literal (geometric)
- `borderRadius: '8px'` → `theme.radius.md`
- The `boxShadow` template with `sequenceStyle[sequence].ghostOpacity - 0.15` stays unchanged — dynamic computed opacity is the documented exception.
- `zIndex: 1` / `2` / `3` → `theme.zIndex.stack.lo` / `md` / `hi`
- `#d1d5db` (placeholder ghost) — this is a single-component shade. Map to `theme.color.gray[300]` if visual review confirms acceptability; otherwise keep literal and add a comment.

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/component/cover/style.ts client/src/component/cover-stack/style.ts
git commit -m "refactor(cover): migrate cover and cover-stack to theme tokens"
```

---

## Task 15: Migrate metadata family (metadata, metadata-list, tag)

**Files:**
- Modify: `client/src/component/metadata/style.ts`
- Modify: `client/src/component/metadata-list/style.ts`
- Modify: `client/src/component/tag/style.ts`

- [ ] **Step 1: Read each file**

```bash
cat client/src/component/metadata/style.ts
cat client/src/component/metadata-list/style.ts
cat client/src/component/tag/style.ts
```

- [ ] **Step 2: Apply token swaps**

For each file:
- `'#1D4ED8'` → `theme.color.blue[600]` (tag only)
- `'#EFF6FF'` → `theme.color.brand.light` (tag only)
- `'#9ca3af'` → `theme.color.text.faint`
- `'0.75rem'` → `theme.fontSize.sm`
- `'0.3em'` → `theme.space.xs` (rounding 0.3em → 0.25rem per spec consolidation)
- `gap: '12px'` (metadata-list) → `theme.space.xl` (0.75rem = 12px exact)
- `lineHeight: '0.75rem'` (metadata-list separator) — keep literal (specific to separator rendering)
- `color: theme.colors.border` in metadata-list → `theme.color.border.default`

Write the migrated file content back.

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/component/metadata/style.ts client/src/component/metadata-list/style.ts client/src/component/tag/style.ts
git commit -m "refactor(metadata): migrate metadata, metadata-list, tag to tokens"
```

---

## Task 16: Migrate book-row and series-row

**Files:**
- Modify: `client/src/component/book-row/style.ts`
- Modify: `client/src/component/series-row/style.ts`

- [ ] **Step 1: Read each file**

```bash
cat client/src/component/book-row/style.ts
cat client/src/component/series-row/style.ts
```

- [ ] **Step 2: Apply token swaps**

Common mappings for both files:
- `'#3f96fe'` / `'#87BAFF'` → `theme.color.brand.hover` / `theme.color.blue[300]`
- `'#e0e0e0'` (book-row placeholder bg) — keep literal with comment (single-component) OR map to `theme.color.gray[150]` after visual review
- `borderRadius: theme.borderRadius.sm` → `theme.radius.sm`
- `theme.colors.primary` (series-row accent) → `theme.color.accent.default`
- `theme.colors.success` → `theme.color.success`
- `fontWeight: 500` → `theme.fontWeight.medium`
- `fontWeight: 600` → `theme.fontWeight.semibold`
- All `padding`/`margin`/`gap` → `theme.space.*`
- All `fontSize` literals/legacy refs → `theme.fontSize.*`

Write the migrated files.

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/component/book-row/style.ts client/src/component/series-row/style.ts
git commit -m "refactor(rows): migrate book-row and series-row to tokens"
```

---

## Task 17: Migrate upload UI (upload-item, upload-zone)

**Files:**
- Modify: `client/src/component/upload-item/style.ts`
- Modify: `client/src/component/upload-zone/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/component/upload-item/style.ts
cat client/src/component/upload-zone/style.ts
```

- [ ] **Step 2: Apply token swaps**

upload-item:
- `theme.text.size.md` / `.sm` → `theme.fontSize.sm` / `.xs` (mapping per spec: old size.md = 12px = fontSize.sm; old size.sm = 10px → fontSize.xs)
- `theme.colors.success` → `theme.color.success`
- `theme.colors.borderLight` (bar bg) → `theme.color.border.light`
- `'#1777FF'` → `theme.color.brand.default`
- The local `@keyframes rotation` block is removed; the spinner rule uses `...theme.recipe.spinner`
- `height: '6px'`, `width: '15px'`, `height: '15px'` — geometry, keep literal
- All padding/margin → `theme.space.*`
- `lineHeight: 0` — keep literal (icon alignment)

upload-zone:
- `theme.colors.primaryLight` → `theme.color.brand.light` (drag-over bg)
- `'#1777FF'` → `theme.color.brand.default`
- `'#dbeafe'` → `theme.color.blue[100]`
- `'background .15s'` transition — keep literal; not on `theme.transition.*` scale
- `borderRadius: '0.5rem'` → keep literal or map to `theme.radius.md` (8px = 0.5rem at 16px base) — confirm via visual review

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/component/upload-item/style.ts client/src/component/upload-zone/style.ts
git commit -m "refactor(upload): migrate upload-item and upload-zone to tokens"
```

---

## Task 18: Migrate user family (user-row, user-row-content, user-progress-row, user-list, user-register)

**Files:**
- Modify: `client/src/component/user-row/style.ts`
- Modify: `client/src/component/user-row-content/style.ts`
- Modify: `client/src/component/user-progress-row/style.ts`
- Modify: `client/src/component/user-list/style.ts`
- Modify: `client/src/component/user-register/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/component/user-row/style.ts
cat client/src/component/user-row-content/style.ts
cat client/src/component/user-progress-row/style.ts
cat client/src/component/user-list/style.ts
cat client/src/component/user-register/style.ts
```

- [ ] **Step 2: Apply token swaps**

Common across these files:
- `'#FFF'` / `'#FFFFFF'` literal text colors → keep literal (`'#FFFFFF'`) only where used on top of brand-colored backgrounds; otherwise map to `theme.color.text.onPrimary`
- `'#FF4D4F'` → `theme.color.danger.default`
- All `fontWeight: 600` → `theme.fontWeight.semibold`
- All `fontWeight: 800` → `theme.fontWeight.extrabold`
- All `fontSize: '0.875rem'` and `'.875rem'` → `theme.fontSize.md`
- `theme.shadows.card` → `theme.shadow.card`
- `borderRadius: theme.borderRadius.sm` → `theme.radius.sm`
- `theme.colors.bg.card` → `theme.color.bg.card`
- `theme.colors.bg.input` → `theme.color.bg.input`
- `theme.colors.border` → `theme.color.border.default`
- All `padding`/`margin`/`gap` → `theme.space.*`
- `transition: 'transform 0.3s linear'` → `transition: \`transform ${theme.transition.slow}\``
- `left: '1.5px'`, `top: '4.5px'`, `width: '2px'` (user-row-content) — keep literal (sub-pixel optical adjustments)
- `'0.92rem'` (user-row title) — keep literal with comment (specific to row title) OR map to `theme.fontSize.md` after visual review

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/component/user-row/style.ts client/src/component/user-row-content/style.ts client/src/component/user-progress-row/style.ts client/src/component/user-list/style.ts client/src/component/user-register/style.ts
git commit -m "refactor(user): migrate user-* components to theme tokens"
```

---

## Task 19: Migrate the small visual components (library-scan, chapter-progress, progress-indicator)

**Files:**
- Modify: `client/src/component/library-scan/style.ts`
- Modify: `client/src/component/chapter-progress/style.ts`
- Modify: `client/src/component/progress-indicator/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/component/library-scan/style.ts
cat client/src/component/chapter-progress/style.ts
cat client/src/component/progress-indicator/style.ts
```

- [ ] **Step 2: Apply token swaps**

- `'#1777FF'` → `theme.color.brand.default`
- `'0.75rem'` → `theme.fontSize.sm`
- `'0.3em'` → `theme.space.xs`
- All `padding`/`gap`/`margin` → `theme.space.*`

Write the migrated files.

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/component/library-scan/style.ts client/src/component/chapter-progress/style.ts client/src/component/progress-indicator/style.ts
git commit -m "refactor(misc): migrate library-scan, chapter-progress, progress-indicator"
```

---

## Task 20: Migrate the list pages (series, library)

**Files:**
- Modify: `client/src/page/series/style.ts`
- Modify: `client/src/page/library/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/page/series/style.ts
cat client/src/page/library/style.ts
```

- [ ] **Step 2: Apply token swaps**

- `theme.colors.primary` → `theme.color.accent.default`
- `theme.colors.primaryHover` → `theme.color.blue[600]`
- `theme.text.size.lg` → `theme.fontSize.lg`
- `theme.text.size.md` → `theme.fontSize.sm`
- All `padding`/`margin`/`gap` → `theme.space.*`
- `fontWeight: 600` / `'600'` / `700` / `'700'` → `theme.fontWeight.semibold` / `.bold`
- All `fontSize` literals → `theme.fontSize.*`

Write the migrated files.

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/page/series/style.ts client/src/page/library/style.ts
git commit -m "refactor(pages): migrate series and library pages to tokens"
```

---

## Task 21: Migrate the book pages (book, book-edit)

**Files:**
- Modify: `client/src/page/book/style.ts`
- Modify: `client/src/page/book-edit/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/page/book/style.ts
cat client/src/page/book-edit/style.ts
```

- [ ] **Step 2: Apply token swaps**

- `theme.colors.primary` → `theme.color.accent.default`
- `theme.colors.primaryHover` → `theme.color.blue[600]`
- `theme.colors.primaryLight` → `theme.color.brand.light`
- `theme.colors.border` → `theme.color.border.default`
- `theme.colors.bg.page` → `theme.color.bg.page`
- `theme.colors.bg.input` → `theme.color.bg.input`
- `theme.borderRadius.sm` → `theme.radius.sm`
- `'#fff'` / `'#FFF'` → `theme.color.text.onPrimary` where used as text on a colored bg; otherwise keep literal
- `'#9ca3af'` → `theme.color.text.faint`
- `'#585863'` (book description) → keep literal with comment (single-component shade)
- `'#E6E6E9'` → keep literal with comment (single-component shade)
- All `fontSize`/`fontWeight`/`padding`/`margin`/`gap` → corresponding tokens
- `'1.3'` lineHeight → `theme.lineHeight.body`

Write the migrated files.

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/page/book/style.ts client/src/page/book-edit/style.ts
git commit -m "refactor(pages): migrate book and book-edit pages to tokens"
```

---

## Task 22: Migrate the remaining pages (login, upload)

**Files:**
- Modify: `client/src/page/login/style.ts`
- Modify: `client/src/page/upload/style.ts`

- [ ] **Step 1: Read each**

```bash
cat client/src/page/login/style.ts
cat client/src/page/upload/style.ts
```

- [ ] **Step 2: Apply token swaps**

login:
- `theme.colors.bg.page` → `theme.color.bg.page`
- `theme.colors.bg.input` → `theme.color.bg.input`
- `theme.colors.primary` → `theme.color.accent.default`
- `theme.colors.border` → `theme.color.border.default`
- `theme.text.size.xlg` → `theme.fontSize.xl`
- `theme.text.size.md` → `theme.fontSize.sm`
- `theme.text.size.lg` → `theme.fontSize.lg`
- `theme.borderRadius.sm` → `theme.radius.sm`
- All `padding`/`margin`/`gap` → `theme.space.*`

upload:
- Apply equivalent token swaps for any literals present.

Write the migrated files.

- [ ] **Step 3: Type-check & commit**

```bash
cd client && npx tsc --noEmit
git add client/src/page/login/style.ts client/src/page/upload/style.ts
git commit -m "refactor(pages): migrate login and upload pages to tokens"
```

---

## Task 23: Remove the legacy compatibility aliases

At this point every `style.ts` references the new tokens. Delete the legacy keys.

**Files:**
- Modify: `client/src/provider/theme/theme.ts`

- [ ] **Step 1: Confirm no remaining legacy refs**

```bash
cd client && grep -rn "theme\.\(colors\|borderRadius\|shadows\|text\.size\)" src/ --include="*.ts" --include="*.tsx"
```

Expected: **no matches** (apart from any reference inside `theme.ts` itself, which gets removed in Step 2).

If grep finds remaining references, return to the task that should have migrated them. Do not proceed until grep is clean.

- [ ] **Step 2: Delete the legacy block from the Theme interface**

In `client/src/provider/theme/theme.ts`, find the comment line:

```ts
  // ─── Legacy compatibility — Phase 5 deletes these ───
```

Delete that comment **and the four interface members below it** (`colors`, `borderRadius`, `shadows`, `text`). The interface should end at the closing brace after the last new-token field (`recipe`).

- [ ] **Step 3: Delete the legacy block from `buildTheme()`**

In the `return` statement of `buildTheme()`, delete the trailing legacy aliases:
- `colors: { ... }`
- `borderRadius: { ... }`
- `shadows: { ... }`
- `text: { ... }`

Keep only `color, space, radius, fontSize, fontWeight, lineHeight, shadow, transition, zIndex, recipe`.

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors. If any errors surface, they indicate a missed legacy reference — find and migrate, then re-run.

- [ ] **Step 5: Commit**

```bash
git add client/src/provider/theme/theme.ts
git commit -m "$(cat <<'EOF'
refactor(theme): drop legacy colors/borderRadius/shadows/text aliases

All components migrated; legacy compatibility layer no longer needed.
EOF
)"
```

---

## Task 24: Final verification

**Files:** none modified

- [ ] **Step 1: Type-check the whole client**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run the test suite**

```bash
cd client && npx vitest run
```

Expected: all tests pass, including the rewritten `provider.test.tsx`.

- [ ] **Step 3: Run lint** (per `feedback_lint_in_task_review.md`)

```bash
npm run lint
```

Expected: no new warnings introduced by the migration. Fix any new warnings before proceeding.

- [ ] **Step 4: Audit remaining bespoke styling** (success criterion #1)

This step is a manual sanity check, not a pass/fail gate. Run:

```bash
cd client && grep -rnE "(#[0-9A-Fa-f]{3,8})" src/ --include="style.ts"
```

Read every hit. Each remaining hex literal must fall into one of these intentional categories:
- A pure white (`'#FFFFFF'` / `'#FFF'`) used as a focus-ring border on a brand-colored background (button primary states)
- A button-only loading/text-button shade (`'#e6e6e6'`, `'#f0f0f0'`) that the spec elected not to put in the global palette
- A single-component shade explicitly called out in the plan (`'#585863'` book description, `'#e0e0e0'` book-row placeholder, `'#d1d5db'` cover-stack ghost) — keep with a one-line `// single-component` comment
- A dynamic value computed by `applyTransparency()` in `cover-stack/style.ts`

Any hex literal that doesn't match one of these is an oversight — find the right token and migrate it.

```bash
cd client && grep -rnE "fontSize: ['\"][^'\"]+['\"]" src/ --include="style.ts"
```

Expected: only the button's `'0.80rem'` (deliberately preserved as button-specific) and any other literals the plan called out. Every other `fontSize:` must reference `theme.fontSize.*`.

```bash
cd client && grep -rnE "borderRadius: ['\"][^'\"]+['\"]" src/ --include="style.ts"
```

Expected: only geometric literals (`'2px'`, `'1px'` for slider ticks, `'10px'` for card-row if you kept it literal) — each line should also visibly belong to a geometry context.

- [ ] **Step 5: Visual smoke test** (success criterion #2)

```bash
cd client && npx vite
```

Open the URL in a browser. Walk through:
- `/` (library) — book and series rows render with correct accent colors and spacing
- A book detail page — accent text, cover, metadata
- `/upload` — upload-zone bg, drag-over highlight
- `/login` (if accessible without auth) — button primary, input borders
- Open a confirm modal (e.g. delete a book) — backdrop blur, header, footer styling

For each, compare side-by-side with `main` (`git stash && npx vite` in another terminal). Any visible difference is a migration error — file an issue and revert the offending mapping.

Stop the dev server (Ctrl-C).

- [ ] **Step 6: Push to `GitHub` remote** (per `feedback_remote_name.md`)

```bash
git push GitHub feat/react-migration
```

The refactor is complete when steps 1–5 all pass and the dev-server walkthrough confirms visual fidelity.

---

## Plan summary

24 tasks; each commits independently. Total expected commits: 22 (Task 6 and Task 24 are verification-only).

- Tasks 1–6: theme module rewrite + provider rewire + verification (Phase 1)
- Tasks 7–11: control migrations (Phase 2 — 10 files)
- Tasks 12–19: component migrations (Phase 3 — 23 files)
- Tasks 20–22: page migrations (Phase 4 — 6 files)
- Tasks 23–24: legacy alias removal + final verification (Phase 5)
