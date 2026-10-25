import cx from 'classnames';
import { Fragment } from 'react';

import { RatingPicker, type RatingValue } from '~/control';

import { useStyle } from './style';

export type RatingFieldKey = 'overall' | 'story' | 'characters' | 'writing' | 'ideas';
export type BookRatingValues = Record<RatingFieldKey, number | null>;

type BookRatingProps = {
  rating: BookRatingValues;
  bookTitle: string;
  readOnly: boolean;
  onRate: (field: RatingFieldKey, value: RatingValue | null) => void;
};

export const RATING_ROWS: ReadonlyArray<{ field: RatingFieldKey; label: string }> = [
  { field: 'overall', label: 'Overall' },
  { field: 'story', label: 'Story' },
  { field: 'characters', label: 'Characters' },
  { field: 'writing', label: 'Writing' },
  { field: 'ideas', label: 'Ideas' },
];

// GraphQL hands ratings over as plain numbers; anything outside 1-5 is no rating.
const toRatingValue = (value: number | null): RatingValue | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;

/**
 * One row per rating field — the field's name, then a segmented picker — with
 * Overall first and set in the primary text colour, since the sub-ratings
 * explain it rather than add up to it. Only the Overall row names its
 * segments; the four rows beneath share the same five icons in the same
 * order, so the names would repeat four times for nothing.
 */
export const BookRating = ({ rating, bookTitle, readOnly, onRate }: BookRatingProps) => {
  const style = useStyle();
  const handler = (field: RatingFieldKey) =>
    readOnly ? undefined : (value: RatingValue | null) => onRate(field, value);

  return (
    <div className={style.root}>
      {RATING_ROWS.map(({ field, label }) => (
        <Fragment key={field}>
          <span className={cx(style.label, { [style.overall]: field === 'overall' })}>{label}</span>
          <RatingPicker
            label={`${label} rating for ${bookTitle}`}
            showNames={field === 'overall'}
            value={toRatingValue(rating[field])}
            onChange={handler(field)}
          />
        </Fragment>
      ))}
    </div>
  );
};
