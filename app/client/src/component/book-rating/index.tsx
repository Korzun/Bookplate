import { useId, useState } from 'react';

import { Button, RatingPicker, type RatingValue } from '~/control';

import { Card } from '../card';
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
 * The "Rating" card: one shaded input row per rating field — the field's name
 * on the left, the segmented picker filling the rest — in the same panel every
 * labelled control in the app sits in (`TextInput`'s `horizontal` layout).
 * Overall is always on screen and is the only row that names its segments.
 * The four detail rows (Story, Characters, Writing, Ideas) sit behind a
 * "More" link button in the card header, which reads "Less" while they show:
 * most ratings are an Overall alone, and four empty rows would push the
 * description down on every unrated book. The details start closed even
 * when some of them have a value: a reader who fills them in still does not
 * want four extra rows on every visit, and Overall is the one that matters at
 * a glance. A read-only view with no details has nothing to disclose and
 * shows no button. The component owns the card so the header button and the
 * rows share one state.
 */
export const BookRating = ({ rating, bookTitle, readOnly, onRate }: BookRatingProps) => {
  const style = useStyle();
  const detailsId = useId();
  const hasDetails = DETAIL_ROWS.some(({ field }) => toRatingValue(rating[field]) !== null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const toggle =
    !readOnly || hasDetails ? (
      <Button
        type="link"
        ariaExpanded={detailsOpen}
        ariaControls={detailsId}
        onClick={() => setDetailsOpen(!detailsOpen)}
      >
        {detailsOpen ? 'Less' : 'More'}
      </Button>
    ) : undefined;

  return (
    <Card title="Rating" headerAction={toggle}>
      <div className={style.root}>
        {row(OVERALL_ROW)}
        {detailsOpen && (
          <div id={detailsId} className={style.details}>
            {DETAIL_ROWS.map(row)}
          </div>
        )}
      </div>
    </Card>
  );
};
