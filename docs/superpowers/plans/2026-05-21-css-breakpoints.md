# CSS Breakpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a two-tier breakpoint system (mobile ≤640px / normal ≥641px) to the theme and use it to make the header non-sticky on mobile.

**Architecture:** Breakpoints are added as `@media (...)` strings to the `Theme` object in `theme.ts`, following the existing pattern for all design tokens. Component styles reference them as JSS computed property keys. The header is the first consumer.

**Tech Stack:** TypeScript, react-jss, Vitest, @testing-library/react

---

### Task 1: Add breakpoints to the theme

**Files:**
- Modify: `client/src/provider/theme/theme.ts`
- Modify: `client/src/provider/theme/provider.test.tsx`

- [ ] **Step 1: Write a failing test for the new breakpoint tokens**

Open `client/src/provider/theme/provider.test.tsx`. Add two spans to `TokenDisplay` and two assertions to the existing test:

```tsx
// In TokenDisplay(), add inside the returned <div>:
<span data-testid="breakpoint-mobile">{theme.breakpoint.mobile}</span>
<span data-testid="breakpoint-normal">{theme.breakpoint.normal}</span>
```

```ts
// In the `it('provides theme tokens to children', ...)` test, add:
expect(screen.getByTestId('breakpoint-mobile').textContent).toBe('@media (max-width: 640px)');
expect(screen.getByTestId('breakpoint-normal').textContent).toBe('@media (min-width: 641px)');
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd client && npm run test -- --reporter=verbose 2>&1 | grep -A5 'breakpoint'
```

Expected: TypeScript error or test failure — `theme.breakpoint` does not exist yet.

- [ ] **Step 3: Add `breakpoint` to the `Theme` interface**

In `client/src/provider/theme/theme.ts`, add to the `Theme` interface (after `zIndex`):

```ts
breakpoint: {
  mobile: string;
  normal: string;
};
```

- [ ] **Step 4: Add `breakpoint` to `buildTheme()`**

In `buildTheme()`, add the value (after the `zIndex` const):

```ts
const breakpoint: Theme['breakpoint'] = {
  mobile: '@media (max-width: 640px)',
  normal: '@media (min-width: 641px)',
};
```

Then include it in the returned object:

```ts
return {
  color,
  space,
  radius,
  size,
  fontSize,
  fontWeight,
  lineHeight,
  shadow,
  transition,
  zIndex,
  breakpoint,
  recipe,
};
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd client && npm run test -- --reporter=verbose 2>&1 | grep -E '(breakpoint|PASS|FAIL|✓|✗)'
```

Expected: all tests pass including the two new breakpoint assertions.

- [ ] **Step 6: Type-check**

```bash
cd client && npm run type 2>&1
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/provider/theme/theme.ts client/src/provider/theme/provider.test.tsx
git commit -m "feat(theme): add mobile/normal breakpoint tokens"
```

---

### Task 2: Make header non-sticky on mobile

**Files:**
- Modify: `client/src/component/header/style.ts`

- [ ] **Step 1: Add the mobile media query to the header root class**

In `client/src/component/header/style.ts`, find the `root` rule and add the breakpoint override as the last property before the closing `},`:

```ts
root: {
  backgroundColor: theme.color.bg.page,
  color: theme.color.gray[900],
  padding: `${theme.space.xxl} ${theme.space.xxxxl}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'sticky',
  top: '0px',
  backdropFilter: 'blur(10px) saturate(10%)',
  zIndex: theme.zIndex.sticky,
  overflow: 'hidden',
  [theme.breakpoint.mobile]: {
    position: 'relative',
  },
},
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
cd client && npm run test -- --reporter=verbose 2>&1 | grep -E '(header|PASS|FAIL|✓|✗)'
```

Expected: all header tests pass.

- [ ] **Step 3: Type-check**

```bash
cd client && npm run type 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/component/header/style.ts
git commit -m "feat(header): make sticky only on normal breakpoint (≥641px)"
```
