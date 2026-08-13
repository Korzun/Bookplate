import { Cover } from '../cover';
import { useStyle } from './style';

export interface CoverStackBook {
  id: string;
  title: string;
  /** Already-resolved, transport-scoped image URL, or `null` for no cover (renders a ghost layer). */
  src: string | null;
}

interface CoverStackProps {
  /** Up to 3 books, in series-reading order (index 0 = book 1). Fewer than 3 pads with ghost layers. */
  books: CoverStackBook[];
  layerWidth: number;
  layerHeight: number;
}

/**
 * Purely presentational: three layered `Cover`s from already-resolved book
 * data, no fetching of its own. Two callers feed it from two different
 * transports:
 *
 * - `SeriesRow` (the GraphQL grid) reads `Series.books(first: 3)` off
 *   `SeriesRowFragment` (`graphql/library.ts`) and maps each node's
 *   `hasCover ? thumbnailUrl : null` into `src` — a server-built URL, same
 *   pattern `BookRowFromEntry` already uses for the grid's book rows.
 * - `page/series` (still reading `useSeriesBookList`, a REST hook, as of
 *   task 6 — `page/series/index.tsx`'s own `BookRowFromSeriesBook` call has
 *   the up-to-date note; task 7 moves this page onto `useSeriesDetail`)
 *   already holds its `useSeriesBookList` result for the page's own "Books"
 *   list and slices the first 3 off that, building `src` from `coverUrl()` +
 *   `withTargetUser()` itself.
 *
 * Before this split, this component called `useSeriesBookList` directly —
 * the SAME hook whose whole-list REST fetch was capped at 20 entries with
 * nothing left to grow it past page 1 once the grid moved to GraphQL
 * pagination (Task 11 deleted the REST `fetchMore` that used to do that).
 * Any series past roughly the library's first 20 REST-sort-order entries
 * rendered three ghost placeholders here regardless of whether the series
 * itself had covers — not because the covers were missing, but because
 * `useSeriesBookList` never saw that series' books at all. Reading straight
 * off the fragment the grid row already has removes that dependency
 * entirely for the grid; `page/series`'s own `useSeriesBookList` call was
 * fixed separately (its own doc comment) to stop depending on that frozen
 * shared list too.
 */
export function CoverStack({ books, layerWidth, layerHeight }: CoverStackProps) {
  const style = useStyle({ layerHeight, layerWidth });

  return (
    <figure className={style.figure}>
      <div className={style.wrapper}>
        {([3, 2, 1] as const).map((seq) => {
          const book = books[3 - seq] ?? null;
          return (
            <Cover
              key={book ? book.id : `ghost-${seq}`}
              src={book?.src ?? null}
              title={book?.title}
              sequence={seq}
              width={layerWidth}
              height={layerHeight}
            />
          );
        })}
      </div>
    </figure>
  );
}
