import {
  HandLoveYouIcon,
  HandOkIcon,
  HandPeaceIcon,
  HandsClapIcon,
  type IconProps,
  ThumbDownIcon,
} from '~/icon';

import { SegmentedControl, type SegmentedOption } from '../segmented-control';

export type RatingValue = 1 | 2 | 3 | 4 | 5;

type RatingOption = {
  value: RatingValue;
  name: string;
  Icon: (props: IconProps) => React.JSX.Element;
};

/** The five values in order; the rating label and the search bar read names and icons from here too. */
export const RATING_OPTIONS: ReadonlyArray<RatingOption> = [
  { value: 1, name: 'Bad', Icon: ThumbDownIcon },
  { value: 2, name: 'Okay', Icon: HandOkIcon },
  { value: 3, name: 'Nice', Icon: HandPeaceIcon },
  { value: 4, name: 'Great', Icon: HandsClapIcon },
  { value: 5, name: 'Love', Icon: HandLoveYouIcon },
];

type RatingKey = `${RatingValue}`;

const SEGMENTS: ReadonlyArray<SegmentedOption<RatingKey>> = RATING_OPTIONS.map(
  ({ value, name, Icon }) => ({ value: `${value}` as RatingKey, label: name, Icon })
);

type RatingPickerProps = {
  value: RatingValue | null;
  /** Absent means read-only: the picker shows the value and ignores input. */
  onChange?: (value: RatingValue | null) => void;
  /** The group's accessible name, e.g. the rating field it edits. */
  label: string;
  /** Render each value's name under its icon, at every width. */
  showNames?: boolean;
  /** See `SegmentedControl`'s `surface`. */
  surface?: 'card' | 'row';
};

/**
 * A `SegmentedControl` of the five rating icons, Bad to Love, whose value can
 * be empty and is cleared by clicking the checked segment, so `null` is
 * always reachable. An out-of-range value (a bad row, a stale cache) reads as
 * no rating.
 */
export const RatingPicker = ({
  value,
  onChange,
  label,
  showNames = true,
  surface = 'card',
}: RatingPickerProps) => (
  <SegmentedControl
    label={label}
    options={SEGMENTS}
    value={value === null ? null : (`${value}` as RatingKey)}
    clearable
    showLabels={showNames}
    surface={surface}
    onChange={
      onChange && ((next) => onChange(next === null ? null : (Number(next) as RatingValue)))
    }
  />
);
