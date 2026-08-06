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
 * `CoverStack` keeps its OWN existing REST data path deliberately
 * (`useSeriesBookList` inside it) — reshaping it needs `Series.books`, which
 * was kept out of `LibraryEntries` on cost-budget grounds. It only needs
 * `seriesName`, unmasked here.
 *
 * Drops the progress badge the REST version showed (`useMySeriesProgress`):
 * `SeriesRowFragment` carries no progress field because the server has none
 * — `Series` (`app/server/graphql/schema/series/model.ts`) exposes no
 * per-series aggregate progress, over REST or GraphQL. Verified against the
 * schema, not assumed; flagged in task 7's report as a disclosed behaviour
 * change rather than silently dropped, since fixing it needs a server
 * change this plan's constraints forbid.
 */
export function SeriesRow({ series }: SeriesRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();
  const unmasked = useFragment(SeriesRowFragment, series);

  const handleNavigate = useCallback(() => {
    navigate(path.series(unmasked.name));
  }, [unmasked.name, navigate]);

  const meta: string[] = [];
  if (unmasked.author) {
    meta.push(unmasked.author);
  }
  meta.push(`${unmasked.bookCount} book series`);

  return (
    <Card size="small" onClick={handleNavigate}>
      <div className={styles.root}>
        <CoverStack seriesName={unmasked.name} layerWidth={44} layerHeight={66} />
        <div className={styles.info}>
          <div className={styles.name}>{unmasked.name}</div>
          <div className={styles.meta}>{meta.join(' · ')}</div>
        </div>
      </div>
    </Card>
  );
}
