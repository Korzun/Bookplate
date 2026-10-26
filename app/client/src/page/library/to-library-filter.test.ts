import { describe, expect, it } from 'vitest';

import { toLibraryFilter } from './to-library-filter';

describe('toLibraryFilter', () => {
  it('passes query/author/seriesName/subjects through unchanged', () => {
    expect(
      toLibraryFilter({
        query: 'dune',
        author: 'Herbert',
        seriesName: 'Dune Chronicles',
        subjects: ['sci-fi', 'classic'],
      })
    ).toEqual({
      query: 'dune',
      author: 'Herbert',
      seriesName: 'Dune Chronicles',
      subjects: ['sci-fi', 'classic'],
      status: undefined,
      entryType: undefined,
      minRating: undefined,
      unrated: undefined,
    });
  });

  it.each([
    ['not-started', 'NOT_STARTED'],
    ['in-progress', 'IN_PROGRESS'],
    ['completed', 'COMPLETED'],
  ] as const)('maps status %s onto %s', (status, expected) => {
    expect(toLibraryFilter({ status }).status).toBe(expected);
  });

  it.each([
    ['series', 'SERIES'],
    ['standalone', 'STANDALONE'],
  ] as const)('maps entryType %s onto %s', (entryType, expected) => {
    expect(toLibraryFilter({ entryType }).entryType).toBe(expected);
  });

  it('leaves status and entryType undefined when absent from the filter', () => {
    const result = toLibraryFilter({ query: 'dune' });
    expect(result.status).toBeUndefined();
    expect(result.entryType).toBeUndefined();
  });

  it('maps minOverall onto minRating.overall', () => {
    expect(toLibraryFilter({ minOverall: 4 }).minRating).toEqual({ overall: 4 });
  });

  it('passes unrated through and leaves minRating undefined', () => {
    const result = toLibraryFilter({ unrated: true });
    expect(result.unrated).toBe(true);
    expect(result.minRating).toBeUndefined();
  });
});
