import { PrismaClient } from '@prisma/client';

import { Owner } from '../types';

/**
 * Recomputes a series' denormalized aggregate columns (subjects, bookCount,
 * author, publisher, totalPages, totalSize) from its current member books.
 * Called from every write path that can change a series' membership or a
 * member book's aggregated fields — add, delete, reimport.
 */
export async function recomputeSeriesMeta(
  client: Pick<PrismaClient, 'book' | 'series'>,
  seriesId: string
): Promise<void> {
  const books = await client.book.findMany({
    where: { seriesId },
    select: { subjects: true, author: true, publisher: true, pageCount: true, size: true },
    orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
  });

  const bookCount = books.length;
  const totalPages = books.reduce((sum, b) => sum + b.pageCount, 0);
  const totalSize = books.reduce((sum, b) => sum + b.size, 0);

  const seenSubjects = new Map<string, string>();
  for (const book of books) {
    let parsedSubjects: string[];
    try {
      const parsed: unknown = JSON.parse(book.subjects);
      parsedSubjects = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      parsedSubjects = [];
    }
    for (const s of parsedSubjects) {
      const key = s.toLowerCase();
      if (!seenSubjects.has(key)) seenSubjects.set(key, s);
    }
  }
  const subjects = [...seenSubjects.values()].sort((a, b) => a.localeCompare(b));

  const seenAuthors = new Map<string, string>();
  for (const book of books) {
    if (book.author) {
      const key = book.author.toLowerCase();
      if (!seenAuthors.has(key)) seenAuthors.set(key, book.author);
    }
  }
  const author = [...seenAuthors.values()].join(', ');

  const seenPublishers = new Map<string, string>();
  for (const book of books) {
    if (book.publisher) {
      const key = book.publisher.toLowerCase();
      if (!seenPublishers.has(key)) seenPublishers.set(key, book.publisher);
    }
  }
  const publisher = [...seenPublishers.values()].join(', ');

  await client.series.update({
    where: { id: seriesId },
    data: {
      subjects: JSON.stringify(subjects),
      bookCount,
      author,
      publisher,
      totalPages,
      totalSize,
    },
  });
}

export async function getSeriesNextIndex(
  prisma: PrismaClient,
  owner: Owner,
  name: string
): Promise<number> {
  const result = await prisma.book.aggregate({
    where: { userId: owner.userId, series: name },
    _max: { seriesIndex: true },
  });
  const max = result._max.seriesIndex;
  return max == null ? 1 : Math.floor(max) + 1;
}
