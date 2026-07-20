const ILLEGAL_FS_CHARS = /[/\\:*?"<>|]/g;
// Preserves \x09 (tab), \x0a (LF), \x0d (CR) so they reach WHITESPACE_RUN and collapse to a single space.
// Matching control characters is the whole point here (stripping them from filenames), so the
// no-control-regex rule is a false positive.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const WHITESPACE_RUN = /\s+/g;
const LEADING_TRAILING = /^[_.]+|[_.]+$/g;

function sanitizeField(input: string): string {
  return input
    .replace(CONTROL_CHARS, '')
    .replace(ILLEGAL_FS_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .replace(/ /g, '_')
    .replace(LEADING_TRAILING, '');
}

function formatSeriesIndex(n: number): string {
  return Number(n).toString().replace('.', '_');
}

export function downloadFilename(book: {
  author: string;
  series: string;
  seriesIndex: number;
  title: string;
}): string {
  const author = sanitizeField(book.author) || 'Unknown';
  const title = sanitizeField(book.title) || 'Unknown';
  const series = sanitizeField(book.series);

  if (series === '') {
    return `${author}-${title}.epub`;
  }

  const index = formatSeriesIndex(book.seriesIndex);
  return `${author}-${series}-${index}-${title}.epub`;
}
