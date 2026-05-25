import cx from 'classnames';
import { useCallback } from 'react';

import { useStyle } from './style';

type SwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  name: string;
  onChange: (checked: boolean) => void;
};

export const Switch = ({ checked, disabled = false, label, name, onChange }: SwitchProps) => {
  const style = useStyle();

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!disabled) onChange(!checked);
    },
    [checked, disabled, onChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onChange(!checked);
      }
    },
    [checked, disabled, onChange]
  );

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label ?? name}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={style.root}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cx(style.track, {
          [style.checked]: checked,
          [style.disabled]: disabled,
        })}
      >
        <div className={style.thumb} />
      </div>
      {label && <span className={style.label}>{label}</span>}
    </div>
  );
};
