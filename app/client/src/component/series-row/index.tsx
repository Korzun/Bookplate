import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useFragment, type FragmentType } from '~/gql';
import { SeriesRowFragment } from '~/graphql/library';
import { path } from '~/router';

import { Card } from '../card';
import { CoverStack } from '../cover-stack';
import { useStyle } from './style';

type SeriesRowProps = {
  series: FragmentType<typeof SeriesRowFragment>;
};

/**
 * Renders from `SeriesRowFragment` — no fetching, no loading/error branch,
 * the parent (`useLibraryEntries`) already has the data. Only consumer is
 * the grid (`page/library`), so unlike `BookRow` this needed no REST
 * adapter split — see task 7's report for why `BookRow` did.
 *
 * `CoverStack` now reads straight off this same fragment's
 * `books(first: 3)` selection (`graphql/library.ts`) instead of its own
 * separate REST fetch — final-branch-review C-1: `CoverStack`'s old
 * `useSeriesBookList` REST path filtered the SAME 20-entry-capped list
 * `page/library` used to grow via REST `fetchMore`, and nothing has grown
 * that list since Task 11 deleted that mechanism in favor of this
 * fragment's own GraphQL pagination — past roughly grid entry 20, the REST
 * list had never seen the series at all, so every stack past that point
 * rendered three ghosts regardless of whether the books actually had
 * covers. Mapping `hasCover ? thumbnailUrl : null` per node here matches
 * `BookRowFromEntry`'s own pattern for the grid's book rows exactly — a
 * server-built, already `?user=`/`v=`-scoped URL, not a client-built one.
 *
 * The progress badge the REST version showed (`useMySeriesProgress`), which
 * task 7 dropped because no such field existed on either transport, is
 * restored here (task 14): `unmasked.progressPercentage` carries
 * `Series.progressPercentage`, the server's aggregate over the same
 * semantics `useMySeriesProgress` used: the mean of each member book's
 * percentage, `null` when none of them have started. Formatting matches
 * the REST version exactly (`< 1` → a rounded percentage, else "Completed"
 * — see `e2a17228`, "show 'Completed' text when series progress reaches
 * 100%").
 */
export function SeriesRow({ series }: SeriesRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();
  const unmasked = useFragment(SeriesRowFragment, series);

  const handleNavigate = useCallback(() => {
    navigate(path.series(unmasked.name));
  }, [unmasked.name, navigate]);

  const coverBooks = unmasked.books.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    src: node.hasCover ? node.thumbnailUrl : null,
  }));

  const meta: string[] = [];
  if (unmasked.author) {
    meta.push(unmasked.author);
  }
  meta.push(`${unmasked.bookCount} book series`);
  if (unmasked.progressPercentage !== null) {
    meta.push(
      unmasked.progressPercentage < 1
        ? `${(unmasked.progressPercentage * 100).toFixed(0)}%`
        : 'Completed'
    );
  }

  return (
    <Card size="small" onClick={handleNavigate}>
      <div className={styles.root}>
        <CoverStack books={coverBooks} layerWidth={44} layerHeight={66} />
        <div className={styles.info}>
          <div className={styles.name}>{unmasked.name}</div>
          <div className={styles.meta}>{meta.join(' · ')}</div>
        </div>
      </div>
    </Card>
  );
}
