import { describe, expect, it } from 'vitest';

import { applySelection, filterToChips, removeChip } from './filter-chips';
import type { Suggestion } from './use-search-suggestions';

const suggestion = (type: Suggestion['type'], value: string): Suggestion => ({
  type,
  label: value,
  value,
  additive: false,
  matchStart: 0,
  matchLength: 0,
});

describe('collection filter chip', () => {
  it('shows a removable Collection chip and removing it clears the filter', () => {
    const chips = filterToChips({ collection: 'Favorites' });
    expect(chips).toEqual([{ kind: 'collection', value: 'Favorites' }]);
    expect(removeChip({ collection: 'Favorites', author: 'X' }, chips[0])).toEqual({
      collection: undefined,
      author: 'X',
    });
  });

  it('choosing a collection suggestion sets collection and clears seriesName', () => {
    expect(
      applySelection({ seriesName: 'Dune', author: 'X' }, suggestion('collection', 'Favorites'))
    ).toEqual({ seriesName: undefined, author: 'X', collection: 'Favorites' });
  });

  it('choosing a series suggestion sets seriesName and clears collection', () => {
    expect(
      applySelection({ collection: 'Favorites', author: 'X' }, suggestion('series', 'Dune'))
    ).toEqual({ collection: undefined, author: 'X', seriesName: 'Dune' });
  });
});
