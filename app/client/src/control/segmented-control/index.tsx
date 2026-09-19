import cx from 'classnames';
import { type CSSProperties, useCallback } from 'react';

import { useStyle } from './style';

type Option = { value: string; label: string };

type SegmentedControlProps = {
  name: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Which surface this control sits on, which decides its corner radius —
   * the same prop, the same two values and the same reasoning as
   * `control/select`'s.
   *
   * `'card'` (default) is the control as it has always looked: `radius.md`,
   * the squarer corner that belongs to a control inset in a card.
   *
   * `'page'` is `radius.lg`, what everything sitting directly on the page
   * already uses, so the control reads as one of them rather than as a card
   * control that escaped.
   */
  surface?: 'card' | 'page';
};

export const SegmentedControl = ({
  name,
  value,
  options,
  onChange,
  disabled = false,
  surface = 'card',
}: SegmentedControlProps) => {
  const style = useStyle();
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return;
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = (activeIndex + delta + options.length) % options.length;
      onChange(options[next].value);
    },
    [activeIndex, disabled, onChange, options]
  );

  const rootStyle = {
    '--seg-count': options.length,
    '--seg-index': activeIndex,
  } as CSSProperties;

  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-disabled={disabled}
      className={cx(style.root, style[surface], { [style.disabled]: disabled })}
      style={rootStyle}
      onKeyDown={handleKeyDown}
    >
      <div className={style.lens} aria-hidden="true" />
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={cx(style.segment, { [style.active]: checked })}
            onClick={() => !disabled && onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
