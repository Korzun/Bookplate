import { useMemo } from 'react';

import type { Progress } from '../type';
import { useMyProgressList } from './use-my-progress-list';

export type UseMyProgress =
  | [undefined, false, false, undefined] // Initial State (or if no progress exists for user)
  | [Progress, false, false, undefined] // Progress was successfully loaded
  | [Progress, true, false, undefined] // Progress was already successfully loaded and new progress is being loaded
  | [undefined, true, false, undefined] // Progress is being loaded
  | [undefined, false, true, undefined] // There was an unspecified error while loading progress
  | [undefined, false, true, string]; // There was a specified error while loading progress
/**
 * `bookId` accepts `undefined` for a caller that only learns the book's
 * real, raw local id asynchronously (e.g. still resolving it off a REST
 * response). No current caller is in that position — `page/book` moved onto
 * GraphQL (`Book.progress` off the Apollo cache) and no longer calls this
 * hook at all; `MyProgressRow`, the one real consumer left, always has a
 * resolved `bookId`. The `undefined` case stays supported for that shape of
 * caller regardless. While `bookId` is `undefined`, this reports the same
 * "not loaded yet" shape as an unresolved lookup, rather than adding a
 * distinct state: there is nothing meaningful to distinguish it from
 * `myProgressList[bookId] === undefined` from the caller's point of view.
 */
export const useMyProgress = (bookId: string | undefined): UseMyProgress => {
  const [myProgressList, loading, error, errorMessage] = useMyProgressList();

  return useMemo((): UseMyProgress => {
    if (error) {
      return [undefined, false, error, errorMessage];
    }

    if (
      bookId === undefined ||
      myProgressList === undefined ||
      myProgressList[bookId] === undefined
    ) {
      return [undefined, loading, false, undefined];
    }
    return [myProgressList[bookId], loading, false, undefined];
  }, [bookId, myProgressList, loading, error, errorMessage]);
};
