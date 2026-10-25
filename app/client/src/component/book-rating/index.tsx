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

const SUB_RATINGS: ReadonlyArray<{ field: Exclude<RatingFieldKey, 'overall'>; label: string }> = [
  { field: 'story', label: 'Story' },
  { field: 'characters', label: 'Characters' },
  { field: 'writing', label: 'Writing' },
  { field: 'ideas', label: 'Ideas' },
];

// GraphQL hands ratings over as plain numbers; anything outside 1-5 is no rating.
const toRatingValue = (value: number | null): RatingValue | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;

export const BookRating = ({ rating, bookTitle, readOnly, onRate }: BookRatingProps) => {
  const style = useStyle();
  const handler = (field: RatingFieldKey) =>
    readOnly ? undefined : (value: RatingValue | null) => onRate(field, value);

  return (
    <div className={style.root}>
      <RatingPicker
        size="md"
        showNames
        label={`Overall rating for ${bookTitle}`}
        value={toRatingValue(rating.overall)}
        onChange={handler('overall')}
      />
      <div className={style.grid}>
        {SUB_RATINGS.map(({ field, label }) => (
          <div key={field} className={style.row}>
            <span className={style.label}>{label}</span>
            <RatingPicker
              size="sm"
              label={`${label} rating for ${bookTitle}`}
              value={toRatingValue(rating[field])}
              onChange={handler(field)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
