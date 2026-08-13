import cx from 'classnames';

import { Card } from '../card';
import { useStyle } from './style';

/**
 * Purely presentational: plain values in, a row out. No hooks, no fetching,
 * no `useFragment` — this component doesn't know which fragment its data was
 * unmasked from. `BookRowFromEntry` (the grid, `BookRowFragment`) and
 * `BookRowFromSeriesBook` (`page/series`, `SeriesBookRowFragment`) are the
 * two fragment-backed adapters that resolve real data into these props; both
 * call their `useFragment` once in their own body and render this. See both
 * files' doc comments for why the split exists.
 */
export interface BookRowProps {
  asCard?: boolean;
  showAuthor?: boolean;
  title: string;
  author: string;
  seriesIndex: number;
  hasCover: boolean;
  /** Already-authorized image src (from `useAuthorizedSrc`), or `undefined` while unresolved / no cover. */
  coverSrc?: string;
  /** 0..1, or `undefined` when there is no progress to show. */
  progressPercentage?: number;
  onClick?: () => void;
}

export function BookRow({
  asCard = true,
  showAuthor = true,
  title,
  author,
  seriesIndex,
  hasCover,
  coverSrc,
  progressPercentage,
  onClick,
}: BookRowProps) {
  const styles = useStyle();

  const meta: string[] = [];
  if (showAuthor && author) {
    meta.push(author);
  }
  if (seriesIndex > 0) {
    meta.push(`Book ${seriesIndex}`);
  }
  if (progressPercentage !== undefined) {
    if (progressPercentage < 1) {
      meta.push(`${(progressPercentage * 100).toFixed(0)}%`);
    } else {
      meta.push(`Completed`);
    }
  }

  const content = (
    <div
      className={cx(styles.root, { [styles.navigate]: !asCard })}
      onClick={!asCard ? onClick : undefined}
    >
      <div className={styles.cover}>
        {hasCover ? (
          <img src={coverSrc} alt={title} className={styles.coverImg} />
        ) : (
          <div className={styles.coverPlaceholder} />
        )}
      </div>
      <div className={styles.info}>
        <div className={styles.title}>{title}</div>
        <div className={styles.meta}>{meta.join(' · ')}</div>
      </div>
    </div>
  );

  return asCard ? (
    <Card size="small" onClick={onClick}>
      {content}
    </Card>
  ) : (
    content
  );
}
