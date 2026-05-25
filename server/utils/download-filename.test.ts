import { downloadFilename } from './download-filename';

describe('downloadFilename', () => {
  it('formats a book with a series', () => {
    expect(
      downloadFilename({
        author: 'J.R.R. Tolkien',
        series: 'The Lord of the Rings',
        seriesIndex: 1,
        title: 'The Fellowship of the Ring',
      })
    ).toBe('J.R.R._Tolkien-The_Lord_of_the_Rings-1-The_Fellowship_of_the_Ring.epub');
  });

  it('formats a standalone (no series)', () => {
    expect(
      downloadFilename({
        author: 'Frank Herbert',
        series: '',
        seriesIndex: 0,
        title: 'Dune',
      })
    ).toBe('Frank_Herbert-Dune.epub');
  });

  it('renders fractional series index with underscore', () => {
    expect(
      downloadFilename({
        author: 'Brandon Sanderson',
        series: 'Stormlight Archive',
        seriesIndex: 1.5,
        title: 'Edgedancer',
      })
    ).toBe('Brandon_Sanderson-Stormlight_Archive-1_5-Edgedancer.epub');
  });

  it('drops trailing zeros on integer-valued floats', () => {
    expect(
      downloadFilename({
        author: 'A',
        series: 'S',
        seriesIndex: 2.0,
        title: 'T',
      })
    ).toBe('A-S-2-T.epub');
  });

  it('emits index of 0 when series is present but index is 0', () => {
    expect(
      downloadFilename({
        author: 'A',
        series: 'S',
        seriesIndex: 0,
        title: 'T',
      })
    ).toBe('A-S-0-T.epub');
  });

  it('substitutes Unknown for empty author', () => {
    expect(downloadFilename({ author: '', series: '', seriesIndex: 0, title: 'Dune' })).toBe(
      'Unknown-Dune.epub'
    );
  });

  it('substitutes Unknown for empty title', () => {
    expect(
      downloadFilename({ author: 'Frank Herbert', series: '', seriesIndex: 0, title: '' })
    ).toBe('Frank_Herbert-Unknown.epub');
  });

  it('substitutes Unknown when both author and title are empty', () => {
    expect(downloadFilename({ author: '', series: '', seriesIndex: 0, title: '' })).toBe(
      'Unknown-Unknown.epub'
    );
  });

  it('treats blank series as absent', () => {
    expect(downloadFilename({ author: 'A', series: '   ', seriesIndex: 3, title: 'T' })).toBe(
      'A-T.epub'
    );
  });

  it('strips filesystem-illegal characters', () => {
    expect(
      downloadFilename({
        author: 'Sue / Bob',
        series: '',
        seriesIndex: 0,
        title: 'Path: A * Memoir? "Final" <draft> | v1',
      })
    ).toBe('Sue_Bob-Path_A_Memoir_Final_draft_v1.epub');
  });

  it('strips control characters', () => {
    expect(
      downloadFilename({
        author: 'A\x00B\x1fC',
        series: '',
        seriesIndex: 0,
        title: 'Title',
      })
    ).toBe('ABC-Title.epub');
  });

  it('collapses whitespace runs to a single underscore', () => {
    expect(
      downloadFilename({
        author: '  Two   Spaces  ',
        series: '',
        seriesIndex: 0,
        title: 'Some\tTabbed\t Title',
      })
    ).toBe('Two_Spaces-Some_Tabbed_Title.epub');
  });

  it('strips leading/trailing underscores and periods', () => {
    expect(
      downloadFilename({
        author: '..A..',
        series: '',
        seriesIndex: 0,
        title: '__T__',
      })
    ).toBe('A-T.epub');
  });

  it('preserves non-ASCII characters', () => {
    expect(
      downloadFilename({
        author: 'Léon Tolstoï',
        series: '',
        seriesIndex: 0,
        title: 'Война и мир',
      })
    ).toBe('Léon_Tolstoï-Война_и_мир.epub');
  });

  it('falls back to Unknown when sanitization empties a required field', () => {
    expect(downloadFilename({ author: '////', series: '', seriesIndex: 0, title: '////' })).toBe(
      'Unknown-Unknown.epub'
    );
  });

  it('drops the series segment when the series sanitizes to empty', () => {
    expect(downloadFilename({ author: 'A', series: '////', seriesIndex: 3, title: 'T' })).toBe(
      'A-T.epub'
    );
  });
});
