import type { Book } from '../book';
import type { UserProgressList } from './type';

export const calculateSeriesProgressPercent = (
  books: Book[],
  progressMap: UserProgressList
): number | undefined => {
  if (!books.some((book) => progressMap[book.id])) {
    return undefined;
  }
  const avg =
    books.reduce((sum, book) => {
      return sum + (progressMap[book.id]?.percentage ?? 0);
    }, 0) / books.length;

  return avg;
};
