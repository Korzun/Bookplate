import { PrismaClient, Prisma } from '@prisma/client';

import { Book, Owner } from '../types';
import { downloadFilename } from '../utils/download-filename';
import { bookPath } from './book-paths';
import { countForBook } from './edition';

/**
 * The catalogue read surface — extracted from `BookStore`. This is the OPDS
 * listing surface (`listBooks`, `listBooksByAuthor`, `listSeries`,
 * `listBooksBySeries`, `listBooksBySubject`, `listBooksByStatus`,
 * `getSubjects`, `getAuthors`) plus `getBookById`, the most widely called
 * read in the codebase (REST/OPDS and eight GraphQL mutations).
 *
 * `standaloneStatusWhere` is exported because `services/library-page.ts`'s
 * `listBooksPage` still needs it — status filtering is unaffected by that
 * function's own rows-not-DTOs contract change (task 8), so this one stays a
 * cross-module export. `BOOK_SELECT` and `prismaBookToBook` were exported for
 * the same reason until task 8: `listBooksPage` used to hydrate a `BookSummary[]`
 * through them. Now that it returns raw Prisma rows instead (task 8's contract
 * change), nothing outside this module needs either, so both are private again.
 */

/**
 * All book columns except coverData (binary blob); coverMime serves as the
 * hasCover proxy.
 *
 * Scoped to `prismaBookToBook`'s DTO: this is every column that mapper writes,
 * which is why it is guarded at COMPILE TIME — the mapper's parameter is
 * `Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>`, so dropping a
 * column it reads fails to build.
 *
 * `services/library-page.ts` has a SECOND, deliberately independent
 * `BOOK_SELECT` for the `Library.entries` read. Do not merge them or derive
 * one from the other: that one selects for what a GraphQL `Book` field
 * resolver reads (its rows go straight to Pothos, never through this DTO),
 * carries `userId`/`seriesId` which this one has no use for, and omits this
 * one's `series` and `validation`. See its doc comment for the full
 * column-by-column reconciliation against this list, and for why the 19 keys
 * they share are a coincidence of two independent requirements rather than a
 * shared one.
 */
const BOOK_SELECT = {
  id: true,
  title: true,
  titleSort: true,
  authorSort: true,
  publishDate: true,
  author: true,
  description: true,
  publisher: true,
  series: true,
  seriesIndex: true,
  identifiers: true,
  subjects: true,
  coverMime: true,
  size: true,
  mtime: true,
  addedAt: true,
  chapterCount: true,
  chapterSpineMap: true,
  chapterNames: true,
  pageCount: true,
  validation: { select: { valid: true } },
} as const;

export function standaloneStatusWhere(
  status: 'not-started' | 'in-progress' | 'completed',
  progressMap: Map<string, number>
): Prisma.BookWhereInput {
  const allStartedIds = [...progressMap.entries()].filter(([, pct]) => pct > 0).map(([id]) => id);
  const inProgressIds = [...progressMap.entries()]
    .filter(([, pct]) => pct > 0 && pct < 1)
    .map(([id]) => id);
  const completedIds = [...progressMap.entries()].filter(([, pct]) => pct >= 1).map(([id]) => id);

  switch (status) {
    case 'not-started':
      return allStartedIds.length > 0 ? { id: { notIn: allStartedIds } } : {};
    case 'in-progress':
      return { id: { in: inProgressIds } };
    case 'completed':
      return { id: { in: completedIds } };
  }
}

function sortByTitle<T extends { titleSort: string; title: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aKey = a.titleSort !== '' ? a.titleSort : a.title;
    const bKey = b.titleSort !== '' ? b.titleSort : b.title;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function prismaBookToBook(
  booksRoot: string,
  owner: Owner,
  r: Prisma.BookGetPayload<{ select: typeof BOOK_SELECT }>
): Book {
  return {
    id: r.id,
    filename: downloadFilename({
      author: r.author,
      series: r.series,
      seriesIndex: r.seriesIndex,
      title: r.title,
    }),
    path: bookPath(booksRoot, owner, r.id),
    title: r.title,
    titleSort: r.titleSort,
    authorSort: r.authorSort,
    publishDate: r.publishDate,
    author: r.author,
    description: r.description,
    publisher: r.publisher,
    series: r.series,
    seriesIndex: r.seriesIndex,
    identifiers: JSON.parse(r.identifiers) as { scheme: string; value: string }[],
    subjects: JSON.parse(r.subjects) as string[],
    hasCover: r.coverMime !== null,
    size: r.size,
    mtime: new Date(r.mtime),
    addedAt: new Date(r.addedAt),
    chapterCount: r.chapterCount,
    chapterSpineMap: JSON.parse(r.chapterSpineMap) as number[],
    chapterNames: r.chapterNames ? (JSON.parse(r.chapterNames) as string[]) : [],
    pageCount: r.pageCount,
    valid: r.validation?.valid ?? null,
  };
}

export async function getSubjects(prisma: PrismaClient, owner: Owner): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT DISTINCT trim(CAST(json_each.value AS TEXT)) AS value
    FROM books, json_each(books.subjects)
    WHERE user_id = ${owner.userId}
      AND json_each.type = 'text'
      AND trim(CAST(json_each.value AS TEXT)) <> ''
    ORDER BY value
  `;
  return rows.map((r) => r.value);
}

export async function listBooks(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner
): Promise<Book[]> {
  const rows = await prisma.book.findMany({
    where: { userId: owner.userId },
    select: BOOK_SELECT,
  });
  return sortByTitle(rows).map((r) => prismaBookToBook(booksRoot, owner, r));
}

export async function getAuthors(prisma: PrismaClient, owner: Owner): Promise<string[]> {
  const rows = await prisma.book.groupBy({
    by: ['author'],
    where: { userId: owner.userId, author: { not: '' } },
    orderBy: { author: 'asc' },
  });
  return rows.map((r) => r.author);
}

export async function listBooksByAuthor(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  author: string
): Promise<Book[]> {
  const rows = await prisma.book.findMany({
    where: { userId: owner.userId, author },
    select: BOOK_SELECT,
  });
  return sortByTitle(rows).map((r) => prismaBookToBook(booksRoot, owner, r));
}

export async function listSeries(
  prisma: PrismaClient,
  owner: Owner
): Promise<{ id: string; name: string; bookCount: number }[]> {
  const rows = await prisma.series.findMany({
    where: { userId: owner.userId },
    select: { id: true, name: true, bookCount: true },
    orderBy: { sortKey: 'asc' },
  });
  return rows;
}

export async function listBooksBySeries(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  seriesId: string
): Promise<Book[]> {
  const rows = await prisma.book.findMany({
    where: { userId: owner.userId, seriesId },
    select: BOOK_SELECT,
    orderBy: [{ seriesIndex: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => prismaBookToBook(booksRoot, owner, r));
}

export async function listBooksBySubject(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  subject: string
): Promise<Book[]> {
  const matched = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT b.id
    FROM books b, json_each(b.subjects) je
    WHERE b.user_id = ${owner.userId}
      AND je.type = 'text'
      AND trim(CAST(je.value AS TEXT)) = ${subject}
  `;
  if (matched.length === 0) return [];
  const ids = matched.map((r) => r.id);
  const rows = await prisma.book.findMany({
    where: { userId: owner.userId, id: { in: ids } },
    select: BOOK_SELECT,
  });
  return sortByTitle(rows).map((r) => prismaBookToBook(booksRoot, owner, r));
}

export async function listBooksByStatus(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  status: 'not-started' | 'in-progress' | 'completed'
): Promise<Book[]> {
  const progresses = await prisma.progress.findMany({
    where: { userId: owner.userId },
    select: { document: true, percentage: true },
  });
  const progressMap = new Map(progresses.map((p) => [p.document, p.percentage]));
  const statusWhere = standaloneStatusWhere(status, progressMap);
  const rows = await prisma.book.findMany({
    where: { userId: owner.userId, ...statusWhere },
    select: BOOK_SELECT,
  });
  return sortByTitle(rows).map((r) => prismaBookToBook(booksRoot, owner, r));
}

export async function getBookById(
  prisma: PrismaClient,
  booksRoot: string,
  owner: Owner,
  id: string,
  opts?: { withEditionCount?: boolean }
): Promise<Book | null> {
  const row = await prisma.book.findUnique({
    where: { userId_id: { userId: owner.userId, id } },
    select: BOOK_SELECT,
  });
  if (!row) return null;
  const book = prismaBookToBook(booksRoot, owner, row);
  if (opts?.withEditionCount) {
    book.deviceEditionCount = await countForBook(prisma, owner.userId, id);
  }
  return book;
}
