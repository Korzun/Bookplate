# BookRow / SeriesRow Visual Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `BookRow` and `SeriesRow` render at the same height with the same visual gap between the cover and the metadata text.

**Architecture:** Four pure style/layout changes — no new components, no behaviour changes. The CoverStack figure gets negative margins on both axes so that flex layout measures from the front cover's edges rather than the container's edges. Cover dimensions are nudged to a shared 43×60px on both rows.

**Tech Stack:** React, JSS-in-JS via `createUseStyles`, Vite/Vitest, ESLint.

---

## File Map

| File | Change |
|---|---|
| `client/src/component/book-row/style.ts` | gap, coverImg/coverPlaceholder dimensions |
| `client/src/component/series-row/style.ts` | gap |
| `client/src/component/series-row/index.tsx` | CoverStack prop values |
| `client/src/component/cover-stack/style.ts` | marginRight, marginBottom on figure |

---

## Task 1: Update BookRow cover dimensions and gap

**Files:**
- Modify: `client/src/component/book-row/style.ts`

- [ ] **Step 1: Open the file and apply the changes**

  Replace the three numeric values shown. No other lines change.

  In `book-row/style.ts`, change `root.gap`, `coverImg`, and `coverPlaceholder`:

  ```ts
  // before
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
  },
  // ...
  coverImg: {
    width: 40,
    height: 56,
    objectFit: 'cover',
    borderRadius: 2,
    display: 'block',
  },
  coverPlaceholder: {
    width: 40,
    height: 56,
    background: '#e0e0e0',
    borderRadius: 2,
  },
  ```

  ```ts
  // after
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  // ...
  coverImg: {
    width: 43,
    height: 60,
    objectFit: 'cover',
    borderRadius: 2,
    display: 'block',
  },
  coverPlaceholder: {
    width: 43,
    height: 60,
    background: '#e0e0e0',
    borderRadius: 2,
  },
  ```

- [ ] **Step 2: Run lint**

  ```bash
  cd client && npm run lint -- src/component/book-row/style.ts
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/component/book-row/style.ts
  git commit -m "style: update BookRow cover to 43×60 and gap to 1rem"
  ```

---

## Task 2: Update SeriesRow gap

**Files:**
- Modify: `client/src/component/series-row/style.ts`

- [ ] **Step 1: Change the gap value**

  ```ts
  // before
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '.9rem',
    // ...
  },
  ```

  ```ts
  // after
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    // ...
  },
  ```

- [ ] **Step 2: Run lint**

  ```bash
  cd client && npm run lint -- src/component/series-row/style.ts
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/component/series-row/style.ts
  git commit -m "style: update SeriesRow gap to 1rem"
  ```

---

## Task 3: Update CoverStack prop values in SeriesRow

**Files:**
- Modify: `client/src/component/series-row/index.tsx`

The `CoverStack` in `SeriesRow` is called with these props today:

```tsx
<CoverStack
  seriesName={seriesName}
  containerWidth={58}
  containerHeight={74}
  layerWidth={44}
  layerHeight={62}
/>
```

Change `containerHeight`, `layerWidth`, and `layerHeight`. Leave `containerWidth={58}` and `seriesName` untouched.

- [ ] **Step 1: Apply the prop changes**

  ```tsx
  // after
  <CoverStack
    seriesName={seriesName}
    containerWidth={58}
    containerHeight={72}
    layerWidth={43}
    layerHeight={60}
  />
  ```

- [ ] **Step 2: Run lint**

  ```bash
  cd client && npm run lint -- src/component/series-row/index.tsx
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/component/series-row/index.tsx
  git commit -m "style: resize CoverStack layers to 43×60 in SeriesRow"
  ```

---

## Task 4: Add negative margins to CoverStack figure

**Files:**
- Modify: `client/src/component/cover-stack/style.ts`

This is the key layout fix. The `figure` element currently has `marginBottom: -6px` and no `marginRight`. We need:

- `marginRight: -15px` — makes flex layout treat the 58px-wide container as 43px wide, so the gap starts from the front cover's right edge. Derivation: `containerWidth(58) − layerWidth(43) = 15`.
- `marginBottom: -12px` — cancels the dead space below the front cover. Derivation: `containerHeight(72) − layerHeight(60) = 12`.

- [ ] **Step 1: Apply the margin changes**

  ```ts
  // before
  figure: {
    flexShrink: 0,
    margin: 0,
    padding: 0,
    marginBottom: '-6px',
  },
  ```

  ```ts
  // after
  figure: {
    flexShrink: 0,
    margin: 0,
    padding: 0,
    marginBottom: '-12px',
    marginRight: '-15px',
  },
  ```

- [ ] **Step 2: Run lint**

  ```bash
  cd client && npm run lint -- src/component/cover-stack/style.ts
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/component/cover-stack/style.ts
  git commit -m "style: add negative margins to CoverStack figure for consistent layout"
  ```

---

## Task 5: Visual verification

**Files:** none changed — this is a read-only verification step.

- [ ] **Step 1: Start the dev server**

  ```bash
  cd client && npm run dev
  ```

  Open the app in a browser. Navigate to a page that shows a mixed list of books and series rows (the main library view).

- [ ] **Step 2: Check horizontal gap**

  The gap between the cover/stack and the title text should look the same for both a `BookRow` and a `SeriesRow`. The fanned back covers should remain fully visible and not overlap the title text.

- [ ] **Step 3: Check row height**

  A `BookRow` and a `SeriesRow` sitting next to each other should appear to be the same height.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

  ```bash
  cd client && npm test
  ```

  Expected: same number of failures as before these changes (pre-existing failures in `src/provider/theme/provider.test.tsx` and import-path errors in several component tests are known and unrelated). No new failures.

- [ ] **Step 5: Run lint across all changed files**

  ```bash
  cd client && npm run lint -- src/component/book-row/style.ts src/component/series-row/style.ts src/component/series-row/index.tsx src/component/cover-stack/style.ts
  ```

  Expected: no errors.
