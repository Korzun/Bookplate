import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { coverUrl } from '~/lib/cover-url';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import type { Book } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';
import { useMyProgress } from '~/provider/progress';
import { path } from '~/router';

import { BookRow } from './index';

interface BookRowFromBookProps {
  asCard?: boolean;
  showAuthor?: boolean;
  book: Book;
}

/**
 * TEMPORARY REST adapter — exists only because `page/series` is not part of
 * this migration plan (`docs/superpowers/plans/2026-08-05-library-target-and-grid.md`'s
 * "What this plan does NOT do" names "series" explicitly as step 6+ work).
 * `page/series` still gets its book list from `useSeriesBookList`, a REST
 * hook, and that page passes the `Book` it already holds here rather than a
 * bare id — one fewer hook than the pre-task-7 shape (`useBook` dropped
 * entirely; `useSeriesBookList` already returns full `Book` records off the
 * same Context map `useBook` would have re-read by id, so re-fetching by id
 * was never buying anything). `useMyProgress` and the cover authorization
 * are real per-row REST reads and stay.
 *
 * Delete this file (and revert `page/series` to the fragment-backed
 * `BookRowFromEntry`, once `page/series` itself reads a GraphQL book list)
 * when series migrates. Do not add new callers in the meantime.
 */
export function BookRowFromBook({ asCard, showAuthor, book }: BookRowFromBookProps) {
  const navigate = useNavigate();
  const withTargetUser = useWithTargetUser();
  const [progress] = useMyProgress(book.id);
  const coverSrc = useAuthorizedSrc(
    book.hasCover ? withTargetUser(coverUrl(book.id, { width: 88, version: book.mtime })) : null
  );
  const handleNavigate = useCallback(() => {
    navigate(path.book(book.id));
  }, [navigate, book.id]);

  return (
    <BookRow
      asCard={asCard}
      showAuthor={showAuthor}
      title={book.title}
      author={book.author}
      seriesIndex={book.seriesIndex}
      hasCover={book.hasCover}
      coverSrc={coverSrc}
      progressPercentage={progress?.percentage}
      onClick={handleNavigate}
    />
  );
}
