import type { BookRowProps } from './index';

/**
 * Narrow the wire `Int` to the picker's 1..5; anything else reads as unrated.
 * Shared by every `BookRow` adapter that selects `rating { overall }`
 * (`from-entry.tsx` for the grid, `from-series-book.tsx` for the series page).
 */
export function toRatingValue(overall: number | null | undefined): BookRowProps['overallRating'] {
  return overall === 1 || overall === 2 || overall === 3 || overall === 4 || overall === 5
    ? overall
    : undefined;
}
