import { seriesSortKey } from './series-sort-key';

describe('seriesSortKey', () => {
  it('drops a leading "The"', () => {
    expect(seriesSortKey('The Lord of the Rings')).toBe('Lord of the Rings');
  });

  it('drops a leading "A"', () => {
    expect(seriesSortKey('A Song of Ice and Fire')).toBe('Song of Ice and Fire');
  });

  it('drops a leading "An"', () => {
    expect(seriesSortKey('An Ember in the Ashes')).toBe('Ember in the Ashes');
  });

  it('is case-insensitive on the article', () => {
    expect(seriesSortKey('the Expanse')).toBe('Expanse');
    expect(seriesSortKey('AN Anthology')).toBe('Anthology');
  });

  it('leaves a name without a leading article unchanged', () => {
    expect(seriesSortKey('Dune')).toBe('Dune');
    expect(seriesSortKey('Mistborn')).toBe('Mistborn');
  });

  it('does not strip an article that is only part of the first word', () => {
    expect(seriesSortKey('Theology Series')).toBe('Theology Series');
    expect(seriesSortKey('Angel Diaries')).toBe('Angel Diaries');
    expect(seriesSortKey('Animorphs')).toBe('Animorphs');
  });

  it('does not strip a bare article with no following word', () => {
    expect(seriesSortKey('The')).toBe('The');
    expect(seriesSortKey('A')).toBe('A');
  });

  it('trims surrounding whitespace', () => {
    expect(seriesSortKey('  The Wheel of Time  ')).toBe('Wheel of Time');
    expect(seriesSortKey('  Dune ')).toBe('Dune');
  });
});
