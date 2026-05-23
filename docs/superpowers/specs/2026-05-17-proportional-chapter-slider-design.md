# Proportional Chapter Slider — Design Spec

**Date:** 2026-05-17
**Branch:** feat/react-migration

## Overview

Replace the equally-spaced `<input type="range">` in `SetProgressModal` with a custom slider that positions each chapter marker at its true proportional position within the book. Tick marks are always visible; chapter names surface in the header display only when the thumb is snapped to that chapter. Dragging is smooth and free; the thumb snaps to the nearest chapter on release (detent behaviour).

## Scope

- Affects `SetProgressModal` and its slider only; the save/delete logic and API are unchanged
- Touch support required (mobile)
- Fallback to equal spacing when spine map data is absent or invalid
- `chapterSpineMap` and `chapterNames` are only needed for the detail view — the list endpoint (`GET /api/books`) continues to strip them

## Architecture

### Backend

**`GET /api/books/:id`** — stop stripping `chapterSpineMap` and `chapterNames` from the response. These two fields are already present on the server-side `Book` object; they just need to be included in the JSON.

`GET /api/books` (list) is unchanged — `chapterSpineMap` and `chapterNames` remain excluded to keep list payloads small.

No schema migrations, no new endpoints.

### Client — Type

`client/src/provider/book/type.ts` — add two optional fields to `Book`:

```ts
chapterSpineMap?: number[];   // spine index of each chapter's first document; length === chapterCount
chapterNames?: string[];      // display name for each chapter; length === chapterCount, empty string when unnamed
```

Optional because the list endpoint omits them; `useBook(id, true)` fetching `/api/books/:id` will populate them.

### Client — New Component: `ProportionalChapterSlider`

**Location:** `client/src/control/proportional-chapter-slider/index.tsx`  
**Style:** `client/src/control/proportional-chapter-slider/style.ts`

Props:
```ts
type ProportionalChapterSliderProps = {
  value: number;                  // 0 = not started, 1..chapterCount = chapter
  onChange: (v: number) => void;
  chapterCount: number;
  chapterSpineMap: number[];
  disabled?: boolean;
};
```

`chapterNames` is **not** a prop — it lives in `SetProgressModal` and is only used for the header display, not rendered inside the slider itself.

**Proportional position formula:**

```ts
function chapterPct(i: number, spineMap: number[], count: number): number {
  if (i === 0) return 0;
  const max = spineMap.length > 0 ? spineMap[spineMap.length - 1] : 0;
  if (!max) return (i / count) * 100;   // equal-spacing fallback
  return (spineMap[i - 1] / max) * 100;
}
```

- Value 0 (not started) → 0% (left edge)
- Value N (last chapter) → 100% (right edge, since `spineMap[N-1] / spineMap[N-1] = 1`)
- Chapters 1…N-1 → proportional positions between 0% and 100%
- Fallback: if `spineMap` is empty or its last entry is 0, uses `i / chapterCount * 100` (equal spacing)

**Snap behaviour:**

```ts
function nearest(pct: number, spineMap: number[], count: number): number {
  let best = 0, bestDist = pct; // dist from 0 = pct
  for (let i = 1; i <= count; i++) {
    const d = Math.abs(pct - chapterPct(i, spineMap));
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
```

On `mouseup` / `touchend`: call `nearest(rawPct)` → animate thumb + fill to snapped position (150 ms ease) → call `onChange(snapped)`.

**Rendered DOM** (all absolutely positioned within the wrapper div):
1. Track (full-width bar)
2. Fill (coloured, from 0 to thumb position)
3. Tick marks at `chapterPct(i)` for `i = 1 … chapterCount - 1` (endpoints have no tick — the track edges serve as visual anchors)
4. Thumb circle

**Mouse events:** `mousedown` on wrapper → `mousemove` / `mouseup` on `document`.  
**Touch events:** `touchstart` on wrapper → `touchmove` / `touchend` on `document`; read `touches[0].clientX`.

Exported from `client/src/control/index.ts`.

### Client — Updated `SetProgressModal`

**New props:**
```ts
chapterSpineMap?: number[];
chapterNames?: string[];
```
Both default to `[]`.

**Chapter display (above slider) — three stacked lines:**

1. **Chapter number** (large, bold): "Not started" (muted) at 0; "Chapter N" at 1…N
2. **Chapter name** (small, italic, muted): shown only when snapped to a chapter that has a name; hidden during drag and at value 0. Uses a fixed `min-height` so the layout doesn't shift.
3. **Subtitle** (small, always visible): "of N chapters"

**Slider:** Replace `<input type="range">` and `sliderLabels` div with `<ProportionalChapterSlider>`. The "Not started" / "Finished" endpoint labels move into the component's style file.

**BookPage** (`client/src/page/book/index.tsx`): pass `chapterSpineMap={book.chapterSpineMap ?? []}` and `chapterNames={book.chapterNames ?? []}` to `SetProgressModal`. No other changes needed — `useBook(id!, true)` already fetches from the detail endpoint.

## Error Handling

- Empty or missing `chapterSpineMap`: component falls back to equal spacing; no visual error
- `chapterNames` shorter than `chapterCount`: treat out-of-bounds indices as unnamed (empty string)

## Testing

- Manual: open Book page as a non-admin user for a book with named chapters → drag slider, verify:
  - Tick marks appear at unequal positions
  - Chapter name appears in header on snap, disappears while dragging
  - Smooth glide, snaps on release
- Manual: repeat with a book that has no chapter names → only "Chapter N" shown, no name line
- Manual: test on a narrow screen / mobile viewport for touch behaviour
- Manual: verify equal-spacing fallback by temporarily passing an empty `chapterSpineMap`
