# BookRow / SeriesRow Visual Consistency

**Date:** 2026-05-02

## Problem

`BookRow` and `SeriesRow` render inconsistently in list views:

- **Horizontal gap:** Different `gap` values (0.75rem vs 0.9rem), and the `CoverStack` container is 14px wider than its front cover, making the visual distance from cover to text ~2.5× larger in `SeriesRow` than in `BookRow`.
- **Row height:** `BookRow` cover is 56px tall; `CoverStack` front cover layer is 62px tall (container 74px, partially offset by `marginBottom: -6px`). Rows appear at noticeably different heights in the list.

## Approach

### Horizontal gap — negative margin on CoverStack figure

Keep `containerWidth={58}` on `CoverStack`. Add `marginRight: -15px` to the `figure` in `cover-stack/style.ts`. This tells flex layout to treat the figure as 43px wide (matching the new `layerWidth`), while still rendering the full 58px. Back covers remain fully visible, clipped by `overflow: hidden`. Both rows then use `gap: '1rem'` (16px), measured from the front cover's right edge.

Back cover right edge: `left(10) + layerWidth(43) = 53px`. Text starts at `layoutWidth(43) + gap(16) = 59px` — 6px clearance.

### Height — resize both covers to 43×60, negative bottom margin

Both covers resized to meet in the middle (BookRow +4px, CoverStack layer −2px), preserving the ~5:7 book-cover aspect ratio. `containerHeight` adjusted to `72` (layerHeight 60 + 12px for back-cover top offset). `marginBottom` changed from `-6px` to `-12px` to cancel the dead space below the front cover.

## File Changes

### `client/src/component/cover-stack/style.ts`

| Property | Before | After |
|---|---|---|
| `figure.marginBottom` | `-6px` | `-12px` |
| `figure.marginRight` | _(none)_ | `-15px` |

### `client/src/component/series-row/index.tsx`

| Prop | Before | After |
|---|---|---|
| `containerHeight` | `74` | `72` |
| `layerWidth` | `44` | `43` |
| `layerHeight` | `62` | `60` |

### `client/src/component/series-row/style.ts`

| Property | Before | After |
|---|---|---|
| `root.gap` | `'.9rem'` | `'1rem'` |

### `client/src/component/book-row/style.ts`

| Property | Before | After |
|---|---|---|
| `root.gap` | `'.75rem'` | `'1rem'` |
| `coverImg.width` | `40` | `43` |
| `coverImg.height` | `56` | `60` |
| `coverPlaceholder.width` | `40` | `43` |
| `coverPlaceholder.height` | `56` | `60` |

## Result

Both rows share identical cover dimensions (43×60), the same gap (1rem) measured from the front cover's right edge, and the same row height. `containerWidth` is unchanged at 58px; the stacked fan effect is fully preserved.
