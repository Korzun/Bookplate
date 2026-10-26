import { RATING_OPTIONS, type RatingValue } from '~/control';

import { useStyle } from './style';

type RatingLabelProps = {
  value: RatingValue;
};

/**
 * An Overall rating as inline text: the value's glyph, then its name ("Love").
 * The one way a rating appears outside the picker — the library's book and
 * series rows, and the series page's metadata — so they all read alike.
 */
export const RatingLabel = ({ value }: RatingLabelProps) => {
  const styles = useStyle();
  const { Icon, name } = RATING_OPTIONS[value - 1];
  return (
    <span aria-label={`Rated ${name}`}>
      <Icon aria-hidden width={14} height={14} className={styles.glyph} />
      <span>{name}</span>
    </span>
  );
};
