import cx from 'classnames';
import { type CSSProperties, type KeyboardEvent, useRef } from 'react';

import type { IconProps } from '~/icon';

import { useStyle } from './style';

export type SegmentedOption<V extends string> = {
  value: V;
  /** The segment's accessible name, and its visible text unless `showLabels` is off. */
  label: string;
  /** Drawn above the label, which then becomes a small caption under it. */
  Icon?: (props: IconProps) => React.JSX.Element;
};

type BaseProps<V extends string> = {
  /** The group's accessible name, e.g. the setting or field it edits. */
  label: string;
  options: ReadonlyArray<SegmentedOption<V>>;
  /** The checked option; `null` (or a value no option has) checks nothing and draws no lens. */
  value: V | null;
  /**
   * Render each option's label. Only an option with an `Icon` can go without
   * one; a text-only option always shows its label.
   */
  showLabels?: boolean;
  /**
   * What the control sits on. `card` (default) paints its own `bg.track`
   * rail. `row` paints nothing: the shaded input row it sits in is the track
   * and only the lens shows, the way the white field shows in a `TextInput`
   * row.
   */
  surface?: 'card' | 'row';
};

type SegmentedControlProps<V extends string> = BaseProps<V> &
  (
    | {
        /** Clicking (or Space/Enter on) the checked segment, Backspace and Delete clear the value. */
        clearable: true;
        /** Absent means read-only: the control shows the value and ignores input. */
        onChange?: (value: V | null) => void;
      }
    | {
        clearable?: false;
        /** Absent means read-only: the control shows the value and ignores input. */
        onChange?: (value: V) => void;
      }
  );

const ICON_SIZE = 20;

/**
 * A row of radios in a track, with a lens that slides to the checked one.
 *
 * The checked segment is not coloured itself. The brand colour is painted on
 * a second copy of the row, clipped to the lens's window and animated with
 * the same spring, so a segment the lens crosses on its way lights up as it
 * passes and dims as it leaves — what a native segmented control does, and
 * what the mobile nav's reveal does. Both rows share one grid and one set of
 * classes, so the copy sits on the real segments pixel for pixel.
 *
 * Keyboard, on the group: ArrowRight/ArrowUp and ArrowLeft/ArrowDown step one
 * option without wrapping (from nothing checked, "next" is the first); Home
 * and End jump to the ends; a digit selects that option directly; Backspace
 * and Delete clear when `clearable`. Space and Enter toggle the focused radio.
 */
export const SegmentedControl = <V extends string>(props: SegmentedControlProps<V>) => {
  const { label, options, value, showLabels = true, surface = 'card' } = props;
  const style = useStyle();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const readOnly = props.onChange === undefined;
  const iconic = options.some((option) => option.Icon !== undefined);
  const checkedIndex = options.findIndex((option) => option.value === value);
  const checked = checkedIndex === -1 ? null : options[checkedIndex];

  const select = (next: V | null) => {
    if (props.onChange === undefined) return;
    if (next === null) {
      if (props.clearable) props.onChange(null);
      return;
    }
    props.onChange(next);
    buttons.current[options.findIndex((option) => option.value === next)]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (readOnly) return;
    // Leave modified keys to the browser and OS: Cmd/Ctrl+digit switches tabs,
    // Alt/Cmd+arrow walks history, Cmd+Backspace and so on.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const last = options.length - 1;
    let nextIndex: number | null | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        if (checkedIndex < last) nextIndex = checkedIndex + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        if (checkedIndex > 0) nextIndex = checkedIndex - 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = last;
        break;
      case 'Backspace':
      case 'Delete':
        if (!props.clearable) return;
        nextIndex = null;
        break;
      default: {
        // A digit picks that option; anything else (Space and Enter included)
        // falls through to the focused button's own handling.
        const digit = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
        if (digit === -1 || digit > last) return;
        nextIndex = digit;
      }
    }
    // Every handled key is consumed, including an arrow at the end of the
    // row, so it never scrolls the page instead.
    event.preventDefault();
    if (nextIndex !== undefined) select(nextIndex === null ? null : options[nextIndex].value);
  };

  // The lens is one segment wide and slides to the checked segment; the
  // segments are equal columns, so its position is just the checked index.
  const rootStyle = {
    '--seg-count': options.length,
    '--seg-index': Math.max(0, checkedIndex),
  } as CSSProperties;

  const content = ({ label: optionLabel, Icon }: SegmentedOption<V>) => (
    <>
      {Icon && <Icon aria-hidden width={ICON_SIZE} height={ICON_SIZE} />}
      {(showLabels || !Icon) && (
        <span className={cx(style.label, { [style.caption]: Icon !== undefined })} aria-hidden>
          {optionLabel}
        </span>
      )}
    </>
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={readOnly ? 'true' : undefined}
      // An icon-led control names its value on hover; a text one already shows it.
      title={iconic ? checked?.label : undefined}
      className={cx(style.root, style[surface], {
        [style.readOnly]: readOnly,
        [style.iconic]: iconic,
      })}
      style={rootStyle}
      onKeyDown={handleKeyDown}
    >
      {checked !== null && <div className={style.lens} aria-hidden="true" />}
      {options.map((option, index) => {
        const isChecked = index === checkedIndex;
        const isTabStop = !readOnly && (checked ? isChecked : index === 0);
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isChecked}
            aria-label={option.label}
            aria-disabled={readOnly ? 'true' : undefined}
            tabIndex={isTabStop ? 0 : -1}
            className={cx(style.segment, { [style.active]: isChecked })}
            onClick={() => select(isChecked ? null : option.value)}
          >
            {content(option)}
          </button>
        );
      })}
      {checked !== null && (
        <div className={style.reveal} aria-hidden="true" data-testid="segmented-reveal">
          {options.map((option) => (
            <span key={option.value} className={style.layerItem}>
              {content(option)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
