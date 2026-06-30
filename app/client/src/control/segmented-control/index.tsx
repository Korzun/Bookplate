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
};

export const SegmentedControl = ({
  name,
  value,
  options,
  onChange,
  disabled = false,
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
      className={cx(style.root, { [style.disabled]: disabled })}
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
