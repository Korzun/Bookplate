import { PrismaClient, Prisma } from '@prisma/client';

import { Owner, SearchSuggestionsResponse } from '../types';
import {
  normalizeForSearch,
  toSubsequenceLike,
  computeMatchWindow,
  scoreAndRank,
} from '../utils/fuzzy-search';

export async function getSearchSuggestions(
  prisma: PrismaClient,
  owner: Owner,
  {
    q,
    filter,
  }: {
    q: string;
    filter: { author?: string; seriesName?: string; activeSubjects?: string[] };
  }
): Promise<SearchSuggestionsResponse> {
  const normalizedQ = normalizeForSearch(q);
  if (!normalizedQ) return { groups: [] };
  const likePat = toSubsequenceLike(normalizedQ);
  const groups: SearchSuggestionsResponse['groups'] = [];

  if (!filter.author) {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT author AS value
      FROM books
      WHERE user_id = ${owner.userId}
        AND author LIKE ${likePat}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
      ORDER BY author
      LIMIT 30
    `;
    const ranked = scoreAndRank(
      rows.map((r) => ({ label: r.value, value: r.value })),
      normalizedQ
    );
    if (ranked.length > 0)
      groups.push({
        type: 'author',
        items: ranked.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });
  }

  if (!filter.seriesName) {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT s.name AS value
      FROM series s
      WHERE s.user_id = ${owner.userId}
        AND s.name LIKE ${likePat}
        ${
          filter.author
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM books b
                WHERE b.series_id = s.id AND b.author = ${filter.author}
              )`
            : Prisma.empty
        }
      ORDER BY s.name
      LIMIT 30
    `;
    const ranked = scoreAndRank(
      rows.map((r) => ({ label: r.value, value: r.value })),
      normalizedQ
    );
    if (ranked.length > 0)
      groups.push({
        type: 'series',
        items: ranked.map(({ label, value }) => ({
          label,
          value,
          ...computeMatchWindow(q, label),
        })),
      });
  }

  const [bookRows, subjectRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; title: string }>>`
      SELECT id, title
      FROM books
      WHERE user_id = ${owner.userId}
        AND title LIKE ${likePat}
        ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
      ORDER BY title
      LIMIT 30
    `,
    prisma.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
      FROM books, json_each(books.subjects)
      WHERE user_id = ${owner.userId}
        AND LOWER(trim(CAST(json_each.value AS TEXT))) LIKE LOWER(${likePat})
        ${filter.author ? Prisma.sql`AND author = ${filter.author}` : Prisma.empty}
        ${filter.seriesName ? Prisma.sql`AND series = ${filter.seriesName}` : Prisma.empty}
        AND json_each.type = 'text'
        AND trim(CAST(json_each.value AS TEXT)) <> ''
      ORDER BY value
      LIMIT 30
    `,
  ]);

  const rankedBooks = scoreAndRank(
    bookRows.map((r) => ({ label: r.title, value: r.id })),
    normalizedQ
  );
  if (rankedBooks.length > 0)
    groups.push({
      type: 'book',
      items: rankedBooks.map(({ label, value }) => ({
        label,
        value,
        ...computeMatchWindow(q, label),
      })),
    });

  const activeSubjectSet = new Set(filter.activeSubjects ?? []);
  const rankedSubjects = scoreAndRank(
    subjectRows
      .filter((r) => !activeSubjectSet.has(r.value))
      .map((r) => ({ label: r.value, value: r.value })),
    normalizedQ
  );
  if (rankedSubjects.length > 0)
    groups.push({
      type: 'subject',
      items: rankedSubjects.map(({ label, value }) => ({
        label,
        value,
        ...computeMatchWindow(q, label),
      })),
    });

  return { groups };
}
