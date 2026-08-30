import { randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';

import { isPrismaError } from './prisma-errors';

/**
 * Stored lowercase; exposed through the `BookRequestStatus` GraphQL enum,
 * whose SCREAMING_CASE members map back onto these exact strings. The enum
 * `satisfies`-checks against this union so the two cannot drift.
 */
export type BookRequestStatus = 'pending' | 'fulfilled' | 'declined';

/**
 * How many requests one reader may have open at once. A module constant, NOT
 * an add-on config option: making it configurable would cost `config.yaml`,
 * the README, and the options table for a number nobody will tune. Counts
 * `pending` rows only — resolving a request frees a slot.
 */
export const MAX_OPEN_BOOK_REQUESTS = 10;

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The duplicate-detection key: both halves lowercased and whitespace-collapsed,
 * joined by a NUL. The separator has to be a character that cannot occur in
 * either half, or `("a b", "c")` and `("a", "b c")` would collide.
 *
 * Pure and exported so the GraphQL layer can test it without a database.
 */
export const dedupeKey = (title: string, author: string): string =>
  `${normalize(title)}\0${normalize(author)}`;

export type BookRequestInput = {
  userId: string;
  title: string;
  author: string;
  note: string;
};

export type CreateBookRequestOutcome =
  | { kind: 'created'; id: string }
  | { kind: 'limit'; limit: number }
  | { kind: 'duplicate'; existingId: string };

/**
 * Creates a pending request, or reports why it did not.
 *
 * RETURNED, NOT THROWN, and therefore never wrapped in `toResult`: both
 * failures are decided by an explicit read inside this function, which is the
 * line this codebase already draws (`createUser` returns `false`,
 * `updateDevice` returns `null`; `DeviceSlugConflictError` is thrown because it
 * escapes a Prisma call as an exception). `KNOWN_DOMAIN_ERROR_CLASSES` gains
 * nothing here.
 *
 * The dedupe check, the cap count, and the insert run in ONE transaction so
 * two concurrent creates cannot both read a count of 9 and both insert.
 *
 * Duplicate detection is scoped to OPEN requests. A fulfilled request means the
 * book is already in the library and a declined one is a wish the admin turned
 * down; a reader may legitimately ask again after either.
 */
export async function createBookRequest(
  prisma: PrismaClient,
  input: BookRequestInput
): Promise<CreateBookRequestOutcome> {
  const key = dedupeKey(input.title, input.author);

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.bookRequest.findFirst({
      where: { userId: input.userId, dedupeKey: key, status: 'pending' },
      select: { id: true },
    });
    if (duplicate !== null) return { kind: 'duplicate', existingId: duplicate.id };

    const open = await tx.bookRequest.count({
      where: { userId: input.userId, status: 'pending' },
    });
    if (open >= MAX_OPEN_BOOK_REQUESTS) {
      return { kind: 'limit', limit: MAX_OPEN_BOOK_REQUESTS };
    }

    const created = await tx.bookRequest.create({
      data: {
        userId: input.userId,
        id: randomUUID(),
        title: input.title.trim(),
        author: input.author.trim(),
        note: input.note.trim(),
        dedupeKey: key,
      },
      select: { id: true },
    });
    return { kind: 'created', id: created.id };
  });
}

export type ResolveOutcome =
  | { kind: 'resolved' }
  | { kind: 'missing' }
  | { kind: 'notPending'; status: BookRequestStatus };

export type FulfillOutcome = ResolveOutcome | { kind: 'noSuchBook' };

/**
 * Links a book to a pending request and closes it.
 *
 * IN A TRANSACTION, unlike `declineBookRequest`, and the asymmetry is
 * deliberate: this one has to validate a SECOND row — the book — before it
 * writes, so the read and the write have to be atomic together. Declining
 * validates nothing else and gets a single guarded `updateMany` instead.
 *
 * `bookUserId !== args.userId` is `noSuchBook`, not a distinct outcome: an
 * admin must not fulfil alice's request with a book off bob's shelf, and
 * saying so in more detail would confirm that bob has that book.
 */
export async function fulfillBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string; bookUserId: string; bookId: string }
): Promise<FulfillOutcome> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.bookRequest.findUnique({
      where: { userId_id: { userId: args.userId, id: args.id } },
      select: { status: true },
    });
    if (request === null) return { kind: 'missing' };
    if (request.status !== 'pending') {
      return { kind: 'notPending', status: request.status as BookRequestStatus };
    }

    if (args.bookUserId !== args.userId) return { kind: 'noSuchBook' };
    const book = await tx.book.findUnique({
      where: { userId_id: { userId: args.bookUserId, id: args.bookId } },
      select: { id: true },
    });
    if (book === null) return { kind: 'noSuchBook' };

    await tx.bookRequest.update({
      where: { userId_id: { userId: args.userId, id: args.id } },
      data: {
        status: 'fulfilled',
        resolvedAt: Date.now(),
        bookUserId: args.bookUserId,
        bookId: args.bookId,
      },
    });
    return { kind: 'resolved' };
  });
}

/**
 * Closes a pending request as declined, with an optional reason.
 *
 * The `status: 'pending'` term in the `where` is what makes this atomic
 * WITHOUT a transaction: the guard and the write are one statement, so two
 * concurrent resolves cannot both see `pending`. The follow-up read only runs
 * when nothing was updated, to tell "no such row" from "already resolved".
 */
export async function declineBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string; reason: string }
): Promise<ResolveOutcome> {
  const updated = await prisma.bookRequest.updateMany({
    where: { userId: args.userId, id: args.id, status: 'pending' },
    data: { status: 'declined', declineReason: args.reason.trim(), resolvedAt: Date.now() },
  });
  if (updated.count === 1) return { kind: 'resolved' };

  const existing = await prisma.bookRequest.findUnique({
    where: { userId_id: { userId: args.userId, id: args.id } },
    select: { status: true },
  });
  return existing === null
    ? { kind: 'missing' }
    : { kind: 'notPending', status: existing.status as BookRequestStatus };
}

/**
 * Deletes a request whatever its status — the reader withdrawing a pending one
 * and either party clearing a resolved one are the same operation. Returns
 * `false` when there was no such row (`P2025`) rather than throwing, the same
 * convention `deleteDevice` and `deleteUser` use.
 */
export async function deleteBookRequest(
  prisma: PrismaClient,
  args: { userId: string; id: string }
): Promise<boolean> {
  try {
    await prisma.bookRequest.delete({
      where: { userId_id: { userId: args.userId, id: args.id } },
    });
    return true;
  } catch (e) {
    if (isPrismaError(e, 'P2025')) return false; // already deleted
    throw e;
  }
}
