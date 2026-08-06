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
});
