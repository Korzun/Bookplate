import cx from 'classnames';
import { Fragment, type ReactNode } from 'react';

import { RATING_OPTIONS } from '~/control';

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
  /** The book's Overall rating (1..5), or `undefined` when unrated. */
  overallRating?: 1 | 2 | 3 | 4 | 5;
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
  overallRating,
  onClick,
}: BookRowProps) {
  const styles = useStyle();

  const meta: ReactNode[] = [];
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
  if (overallRating !== undefined) {
    const { Icon, name } = RATING_OPTIONS[overallRating - 1];
    meta.push(
      <span key="rating" aria-label={`Rated ${name}`}>
        <Icon aria-hidden width={14} height={14} className={styles.ratingGlyph} />
        <span>{name}</span>
      </span>
    );
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
        <div className={styles.meta}>
          {meta.map((item, i) => (
            <Fragment key={i}>
              {i > 0 ? ' · ' : null}
              {item}
            </Fragment>
          ))}
        </div>
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
