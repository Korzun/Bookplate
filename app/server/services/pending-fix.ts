import { PrismaClient } from '@prisma/client';

import { Owner, PendingFixState } from '../types';

/**
 * `upsertPendingFix` — extracted from `BookStore`. `deletePendingFix`
 * (`prisma.pendingFix.deleteMany`, a single statement with no error
 * conversion) did NOT move here: it is this phase's one inline. It is
 * folded directly into its lone production call site (the CLEAR branch of
 * `bookResolvePendingFix`) and into the early-return branch below, which
 * used to call it as `this.deletePendingFix(owner, bookId)`.
 */
export async function upsertPendingFix(
  prisma: PrismaClient,
  owner: Owner,
  bookId: string,
  fileName: string,
  fileSize: number,
  state: PendingFixState
): Promise<void> {
  const resolved = state.proposals.length === 0 && !state.undo;
  if (resolved) {
    await prisma.pendingFix.deleteMany({
      where: { userId: owner.userId, bookId },
    });
    return;
  }
  const data = {
    fileName,
    fileSize,
    state: JSON.stringify(state),
    updatedAt: Date.now(),
  };
  await prisma.pendingFix.upsert({
    where: { userId_bookId: { userId: owner.userId, bookId } },
    create: { userId: owner.userId, bookId, ...data },
    update: data,
  });
}
