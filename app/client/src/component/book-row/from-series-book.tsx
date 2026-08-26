import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { graphql, useFragment, type FragmentType } from '~/gql';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { path } from '~/router';

import { BookRow } from './index';

/**
 * Colocated: this component declares exactly the fields it renders, and
 * `page/series` composes `SeriesDetailDocument` around it (spread by NAME
 * inside `Series.books(first: 100) { edges { node { ...SeriesBookRowFragment
 * } } }` — codegen resolves that against this `graphql(...)` definition
 * without a JS import between the two files). `page/series` ALSO imports
 * this fragment object directly (unlike `BookRowFragment`'s page): it needs
 * to unmask the whole list once, up front, to build `CoverStack`'s cover
 * slice and real per-row React keys — see that file's own doc comment for
 * why that's a single array-overload `useFragment` call rather than a
 * central per-item unmask.
 *
 * Deliberately NOT `BookRowFragment` (`component/book-row/from-entry.tsx`):
 * that one selects `thumbnailUrl(width: 88)` for the grid and is spread
 * inside the `LibraryEntry` union, where `Series`'s own fields sit beside
 * it. This is a plain `Series.books` edge — no union, no collision — and
 * the series page shows no author per row (`showAuthor={false}`), so
 * `author` is dropped.
 */
export const SeriesBookRowFragment = graphql(`
  fragment SeriesBookRowFragment on Book {
    id
    title
    seriesIndex
    hasCover
    thumbnailUrl(width: 88)
    progress {
      id
      percentage
    }
  }
`);

interface BookRowFromSeriesBookProps {
  asCard?: boolean;
  showAuthor?: boolean;
  book: FragmentType<typeof SeriesBookRowFragment>;
}

/**
 * The series page's adapter — the GraphQL replacement for `from-book.tsx`,
 * the REST adapter whose own doc comment asked to be deleted "when series
 * migrates". Structurally identical to `BookRowFromEntry`: one unconditional
 * `useFragment` in its own render context (one component per row), so a shared
 * unmask inside a `.map()` never collides with `react-hooks/rules-of-hooks`.
 *
 * Calls no progress hook. `SeriesBookRowFragment` already carries
 * `progress { percentage }`, so `useMyProgress` here would re-fetch data the
 * parent's `SeriesDetail` query already holds — and, since `useMyProgress`'s map
 * is keyed by the RAW content hash while `unmasked.id` is a Relay global ID, it
 * would silently miss on every row besides.
 *
 * `thumbnailUrl` is server-built with the correct `?user=`/`v=` suffix, so no
 * `withTargetUser()` wrapping is needed — the same reason `BookRowFromEntry`
 * dropped it.
 */
export function BookRowFromSeriesBook({ asCard, showAuthor, book }: BookRowFromSeriesBookProps) {
  const navigate = useNavigate();
  const unmasked = useFragment(SeriesBookRowFragment, book);
  const coverSrc = useAuthorizedSrc(unmasked.hasCover ? unmasked.thumbnailUrl : null);
  const handleNavigate = useCallback(() => {
    navigate(path.book(unmasked.id));
  }, [navigate, unmasked.id]);

  return (
    <BookRow
      asCard={asCard}
      showAuthor={showAuthor}
      title={unmasked.title}
      author=""
      seriesIndex={unmasked.seriesIndex}
      hasCover={unmasked.hasCover}
      coverSrc={coverSrc}
      progressPercentage={unmasked.progress?.percentage}
      onClick={handleNavigate}
    />
  );
}
