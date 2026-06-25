// Leading articles that are ignored when sorting a series, mirroring the Title
// Sort behaviour applied to individual books: a series named "The Foo" sorts as
// "Foo", "A Bar" sorts as "Bar", and "An Egg" sorts as "Egg".
//
// This mirrors the server-side `seriesSortKey` (app/server/utils/series-sort-key.ts),
// which computes the sort_key persisted for each series row.
const LEADING_ARTICLE = /^(?:the|a|an)\s+(\S.*)$/i;

/**
 * Compute the sort key for a series name. If the name begins with the article
 * "the", "a", or "an" followed by another word, the article is dropped so the
 * series sorts by its second word. Otherwise the trimmed name is used as-is.
 */
export const seriesSortKey = (name: string): string => {
  const trimmed = name.trim();
  const match = LEADING_ARTICLE.exec(trimmed);
  return match ? match[1] : trimmed;
};
