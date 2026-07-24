import type { UploadItem } from '~/provider/book';

import { useUploadQueue } from './use-upload-queue';

/** The queue item for `bookId` iff it still has fixes awaiting a decision.
 * Used by the book-edit page to detect a pending-fix conflict. */
export const usePendingFixesForBook = (bookId?: string): UploadItem | undefined => {
  const { items } = useUploadQueue();
  if (!bookId) return undefined;
  return items.find((i) => i.bookId === bookId && (i.proposals?.length ?? 0) > 0);
};
