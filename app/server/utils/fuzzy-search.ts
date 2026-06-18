export function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function toSubsequenceLike(normalized: string): string {
  if (!normalized) return '%';
  return '%' + normalized.split('').join('%') + '%';
}

export function fuzzyScore(normalizedQuery: string, normalizedCandidate: string): number {
  if (!normalizedQuery) return 0;
  if (normalizedCandidate.includes(normalizedQuery)) return 1.0;

  let qi = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let ci = 0; ci < normalizedCandidate.length && qi < normalizedQuery.length; ci++) {
    if (normalizedCandidate[ci] === normalizedQuery[qi]) {
      if (firstMatch === -1) firstMatch = ci;
      lastMatch = ci;
      qi++;
    }
  }
  if (qi < normalizedQuery.length) return 0;

  const windowLength = lastMatch - firstMatch + 1;
  const tightness = normalizedQuery.length / windowLength;
  return 0.4 + tightness * 0.5;
}

export function computeMatchWindow(
  query: string,
  label: string
): { matchStart: number; matchLength: number } {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return { matchStart: 0, matchLength: 0 };

  let qi = 0;
  let firstPos = -1;
  let lastPos = -1;
  for (let i = 0; i < label.length && qi < normalizedQuery.length; i++) {
    const ch = label[i].toLowerCase();
    if (/[a-z0-9]/.test(ch) && ch === normalizedQuery[qi]) {
      if (firstPos === -1) firstPos = i;
      lastPos = i;
      qi++;
    }
  }
  if (qi < normalizedQuery.length || firstPos === -1) return { matchStart: 0, matchLength: 0 };
  return { matchStart: firstPos, matchLength: lastPos - firstPos + 1 };
}

export function scoreAndRank(
  items: Array<{ label: string; value: string }>,
  normalizedQuery: string,
  limit = 5
): Array<{ label: string; value: string }> {
  return items
    .map((item) => ({ item, score: fuzzyScore(normalizedQuery, normalizeForSearch(item.label)) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}
