import cx from 'classnames';
import { useId, useState } from 'react';

import { RatingPicker, type RatingValue } from '~/control';
import { ChevronIcon } from '~/icon';

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

const [OVERALL_ROW, ...DETAIL_ROWS] = RATING_ROWS;

// GraphQL hands ratings over as plain numbers; anything outside 1-5 is no rating.
const toRatingValue = (value: number | null): RatingValue | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;

/**
 * One shaded input row per rating field — the field's name on the left, the
 * segmented picker filling the rest — in the same panel every labelled
 * control in the app sits in (`TextInput`'s `horizontal` layout). Overall is
 * always on screen and is the only row that names its segments. The four
 * detail rows (Story, Characters, Writing, Ideas) sit behind a "Details"
 * disclosure: most ratings are an Overall alone, and four empty rows would
 * push the description down on every unrated book. The disclosure opens
 * itself whenever any detail has a value, so a rated book shows everything,
 * and follows the reader's own toggle from then on. A read-only view with no
 * details has nothing to disclose and shows no toggle.
 */
export const BookRating = ({ rating, bookTitle, readOnly, onRate }: BookRatingProps) => {
  const style = useStyle();
  const detailsId = useId();
  const hasDetails = DETAIL_ROWS.some(({ field }) => toRatingValue(rating[field]) !== null);
  // `null` until the reader toggles; before that the data decides.
  const [detailsChoice, setDetailsChoice] = useState<boolean | null>(null);
  const detailsOpen = detailsChoice ?? hasDetails;
  const handler = (field: RatingFieldKey) =>
    readOnly ? undefined : (value: RatingValue | null) => onRate(field, value);

  const row = ({ field, label }: (typeof RATING_ROWS)[number]) => (
    <div key={field} className={style.row}>
      <span className={style.label}>{label}</span>
      <RatingPicker
        surface="row"
        label={`${label} rating for ${bookTitle}`}
        showNames={field === 'overall'}
        value={toRatingValue(rating[field])}
        onChange={handler(field)}
      />
    </div>
  );

  return (
    <div className={style.root}>
      {row(OVERALL_ROW)}
      {(!readOnly || hasDetails) && (
        <button
          type="button"
          className={style.toggle}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsChoice(!detailsOpen)}
        >
          <ChevronIcon
            aria-hidden
            width={16}
            height={16}
            className={cx(style.chevron, { [style.chevronOpen]: detailsOpen })}
          />
          Details
        </button>
      )}
      {detailsOpen && (
        <div id={detailsId} className={style.details}>
          {DETAIL_ROWS.map(row)}
        </div>
      )}
    </div>
  );
};
