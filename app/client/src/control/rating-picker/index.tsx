import cx from 'classnames';
import { type CSSProperties, type KeyboardEvent, useRef } from 'react';

import {
  HandLoveYouIcon,
  HandOkIcon,
  HandPeaceIcon,
  HandsClapIcon,
  type IconProps,
  ThumbDownIcon,
} from '~/icon';

import { useStyle } from './style';

export type RatingValue = 1 | 2 | 3 | 4 | 5;

type RatingOption = {
  value: RatingValue;
  name: string;
  Icon: (props: IconProps) => React.JSX.Element;
};

export const RATING_OPTIONS: ReadonlyArray<RatingOption> = [
  { value: 1, name: 'Bad', Icon: ThumbDownIcon },
  { value: 2, name: 'Okay', Icon: HandOkIcon },
  { value: 3, name: 'Nice', Icon: HandPeaceIcon },
  { value: 4, name: 'Great', Icon: HandsClapIcon },
  { value: 5, name: 'Love', Icon: HandLoveYouIcon },
];

const ICON_SIZE = 20;

type RatingPickerProps = {
  value: RatingValue | null;
  /** Absent means read-only: the picker shows the value and ignores input. */
  onChange?: (value: RatingValue | null) => void;
  /** The group's accessible name, e.g. the rating field it edits. */
  label: string;
  /** Render each value's name under its icon, at every width. */
  showNames?: boolean;
  /**
   * What the picker sits on. `track` (default) paints its own `bg.track`
   * rail, like `control/segmented-control`. `row` paints nothing: the shaded
   * input row it sits in (`bg.cardHeader`, the same grey as the rail in light
   * mode) is the track, and only the lens shows, the way the white field
   * shows in a `TextInput` row.
   */
  surface?: 'track' | 'row';
};

/**
 * A segmented control of five icon radios, Bad to Love, in the same
 * track-and-lens style as `control/segmented-control`. Unlike that control the
 * value can be empty — no lens — and clicking (or Space/Enter on) the checked
 * segment clears it, so `null` is always reachable.
 *
 * Keyboard, on the group: ArrowRight/ArrowUp and ArrowLeft/ArrowDown step one
 * value without wrapping (from no rating, "next" is Bad); Home and End jump to
 * Bad and Love; the digits 1–5 select directly; Backspace and Delete clear.
 */
export const RatingPicker = ({
  value,
  onChange,
  label,
  showNames = true,
  surface = 'track',
}: RatingPickerProps) => {
  const style = useStyle();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const readOnly = onChange === undefined;
  // An out-of-range value (a bad row, a stale cache) reads as no rating.
  const checkedIndex = RATING_OPTIONS.findIndex((option) => option.value === value);
  const checked = checkedIndex === -1 ? null : RATING_OPTIONS[checkedIndex];

  const select = (next: RatingValue | null) => {
    if (!onChange) return;
    onChange(next);
    if (next !== null) buttons.current[next - 1]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (readOnly) return;
    // Leave modified keys to the browser and OS: Cmd/Ctrl+digit switches tabs,
    // Alt/Cmd+arrow walks history, Cmd+Backspace and so on.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Position on the 1–5 scale, 0 for no rating.
    const current = checked?.value ?? 0;
    let next: RatingValue | null | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        if (current < 5) next = (current + 1) as RatingValue;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        if (current > 1) next = (current - 1) as RatingValue;
        break;
      case 'Home':
        next = 1;
        break;
      case 'End':
        next = 5;
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        next = Number(event.key) as RatingValue;
        break;
      case 'Backspace':
      case 'Delete':
        next = null;
        break;
      default:
        // Space and Enter fall through to the focused button's own click.
        return;
    }
    // Every handled key is consumed, including an arrow at the end of the
    // scale, so it never scrolls the page instead.
    event.preventDefault();
    if (next !== undefined) select(next);
  };

  // The lens is one segment wide and slides to the checked segment; the
  // segments are equal columns, so its position is just the checked index.
  const rootStyle = {
    '--seg-count': RATING_OPTIONS.length,
    '--seg-index': Math.max(0, checkedIndex),
  } as CSSProperties;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={readOnly ? 'true' : undefined}
      title={checked?.name}
      className={cx(style.root, style[surface], { [style.readOnly]: readOnly })}
      style={rootStyle}
      onKeyDown={handleKeyDown}
    >
      {checked !== null && <div className={style.lens} aria-hidden="true" />}
      {RATING_OPTIONS.map(({ value: optionValue, name, Icon }, index) => {
        const isChecked = checked?.value === optionValue;
        const isTabStop = !readOnly && (checked ? isChecked : index === 0);
        return (
          <button
            key={optionValue}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isChecked}
            aria-label={name}
            aria-disabled={readOnly ? 'true' : undefined}
            tabIndex={isTabStop ? 0 : -1}
            className={cx(style.segment, { [style.active]: isChecked })}
            onClick={() => select(isChecked ? null : optionValue)}
          >
            <Icon aria-hidden width={ICON_SIZE} height={ICON_SIZE} />
            {showNames && (
              <span className={style.name} aria-hidden>
                {name}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
