import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { useSeriesBookList } from '~/provider/book';
import { useMySeriesProgress } from '~/provider/progress';
import { path } from '~/router';

import { Card } from '../card';
import { CoverStack } from '../cover-stack';
import { useStyle } from './style';

type SeriesRowProps = {
  seriesName: string;
};
export function SeriesRow({ seriesName }: SeriesRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();
  const [bookList, loading, error] = useSeriesBookList(seriesName);
  const [seriesProgressPercent] = useMySeriesProgress(seriesName);

  const handleNavigate = useCallback(() => {
    navigate(path.series(seriesName));
  }, [seriesName, navigate]);

  if (loading === true) {
    return (
      <Card size="small">
        <div className={styles.root}>Loading...</div>
      </Card>
    );
  }
  if (error === true) {
    return (
      <Card size="small">
        <div className={styles.root}>Error</div>
      </Card>
    );
  }

  const meta: string[] = [];
  if (bookList[0]?.author) {
    meta.push(bookList[0]?.author);
  }
  meta.push(`${bookList.length} book series`);
  if (seriesProgressPercent !== undefined) {
    if (seriesProgressPercent < 1) {
      meta.push(`${(seriesProgressPercent * 100).toFixed(0)}%`);
    } else {
      meta.push(`Completed`);
    }
  }

  return (
    <Card size="small" onClick={handleNavigate}>
      <div className={styles.root}>
        <CoverStack seriesName={seriesName} layerWidth={44} layerHeight={66} />
        <div className={styles.info}>
          <div className={styles.name}>{seriesName}</div>
          <div className={styles.meta}>{meta.join(' · ')}</div>
        </div>
      </div>
    </Card>
  );
}
