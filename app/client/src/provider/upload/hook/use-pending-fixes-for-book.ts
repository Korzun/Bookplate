import type { UploadItem } from './use-upload-queue';
import { useUploadQueue } from './use-upload-queue';

/** The queue item for `bookGlobalId` iff it still has fixes awaiting a
 * decision. Used by the book-edit page to detect a pending-fix conflict.
 *
 * Takes a Book GLOBAL id, not a raw content hash (Task 8): `UploadItem` lost
 * `bookId` in the merge onto GraphQL, so `bookGlobalId` is the only book
 * identifier a queue item carries. `page/book-edit` passes `book?.id`. */
export const usePendingFixesForBook = (bookGlobalId?: string): UploadItem | undefined => {
  const { items } = useUploadQueue();
  if (!bookGlobalId) return undefined;
  return items.find((i) => i.bookGlobalId === bookGlobalId && (i.proposals?.length ?? 0) > 0);
};
