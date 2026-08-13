import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useFragment, type FragmentType } from '~/gql';
import { SeriesBookRowFragment } from '~/graphql/series';
import { useAuthorizedSrc } from '~/lib/use-authorized-src';
import { path } from '~/router';

import { BookRow } from './index';

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
