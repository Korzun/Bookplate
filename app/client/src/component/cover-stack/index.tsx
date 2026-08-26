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
 * data, no fetching of its own. Two callers, both GraphQL, both building
 * `src` the same way (`hasCover ? thumbnailUrl : null` — a server-built URL,
 * already scoped, no `coverUrl()`/`withTargetUser()` involved):
 *
 * - `SeriesRow` (the library grid) reads `Series.books(first: 3)` off
 *   `SeriesRowFragment` (`component/series-row/index.tsx`) and maps each node directly —
 *   same pattern `BookRowFromEntry` already uses for the grid's book rows.
 * - `page/series` reads `SeriesDetailDocument`'s `series.books.edges`
 *   (masked `SeriesBookRowFragment` refs — that fragment is declared on
 *   `component/book-row/from-series-book.tsx`, not read through a hook),
 *   unmasks the whole list in one `useFragment(SeriesBookRowFragment, ...)`
 *   call at `page/series/index.tsx` (its own array overload — see that
 *   file's doc comment for why that beats unmasking per-item in a `.map()`),
 *   and slices the first 3 off the unmasked result.
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
