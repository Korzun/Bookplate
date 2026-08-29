import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Cover and thumbnail IO — extracted from `BookStore`. Despite the name,
 * none of these currently touch the filesystem: covers and thumbnails are
 * stored as DB blobs (`Book.coverData` / `BookThumbnail.data`), not as
 * files under `booksRoot`. They stay as standalone functions rather than
 * candidates for inlining because they're shared across multiple call
 * sites (routes, `ThumbnailQueue`) that would otherwise duplicate the
 * Prisma queries.
 */

export async function getCover(
  prisma: PrismaClient,
  userId: string,
  id: string
): Promise<{ data: Buffer; mime: string } | null> {
  const row = await prisma.book.findUnique({
    where: { userId_id: { userId, id } },
    select: { coverData: true, coverMime: true },
  });
  if (!row || !row.coverData) return null;
  // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
  return { data: Buffer.from(row.coverData), mime: row.coverMime as string };
}

export async function saveThumbnail(
  prisma: PrismaClient,
  userId: string,
  bookId: string,
  width: number,
  data: Buffer,
  mime: string
): Promise<void> {
  await prisma.bookThumbnail.upsert({
    where: { userId_bookId_width: { userId, bookId, width } },
    update: { data: data as unknown as Prisma.Bytes, mime },
    create: { userId, bookId, width, data: data as unknown as Prisma.Bytes, mime },
  });
}

export async function getThumbnail(
  prisma: PrismaClient,
  userId: string,
  bookId: string,
  width: number
): Promise<{ data: Buffer; mime: string } | null> {
  const row = await prisma.bookThumbnail.findUnique({
    where: { userId_bookId_width: { userId, bookId, width } },
  });
  // Prisma returns BLOB columns as Uint8Array; Buffer.from() ensures Express sends binary
  return row ? { data: Buffer.from(row.data), mime: row.mime } : null;
}

export async function pruneThumbnails(
  prisma: PrismaClient,
  configuredWidths: number[]
): Promise<number> {
  if (configuredWidths.length === 0) {
    const result = await prisma.bookThumbnail.deleteMany({});
    return result.count;
  }
  const result = await prisma.bookThumbnail.deleteMany({
    where: { width: { notIn: configuredWidths } },
  });
  return result.count;
}

export async function getMissingThumbnailPairs(
  prisma: PrismaClient,
  widths: number[]
): Promise<Array<{ userId: string; bookId: string; width: number }>> {
  const result: Array<{ userId: string; bookId: string; width: number }> = [];
  for (const width of widths) {
    const rows = await prisma.book.findMany({
      where: {
        coverMime: { not: null },
        thumbnails: { none: { width } },
      },
      select: { userId: true, id: true },
    });
    for (const { userId, id } of rows) {
      result.push({ userId, bookId: id, width });
    }
  }
  return result;
}
