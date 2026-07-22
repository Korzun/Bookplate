import cx from 'classnames';
import { ReactNode, useCallback } from 'react';

import { useStyle } from './style';

type SwitchProps = {
  checked: boolean;
  description?: ReactNode;
  disabled?: boolean;
  label?: string;
  layout?: 'default' | 'horizontal';
  name: string;
  onChange: (checked: boolean) => void;
};

export const Switch = ({
  checked,
  description,
  disabled = false,
  label,
  layout = 'default',
  name,
  onChange,
}: SwitchProps) => {
  const style = useStyle();
  const descriptionId = description ? `${name}-description` : undefined;

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

  // The description is helper text, not a toggle target — clicking it should
  // not flip the switch.
  const handleDescriptionClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label ?? name}
      aria-describedby={descriptionId}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={cx(style.root, { [style.horizontal]: layout === 'horizontal' })}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className={style.row}>
        {layout === 'horizontal' && label && <span className={style.label}>{label}</span>}
        <div
          className={cx(style.track, {
            [style.checked]: checked,
            [style.disabled]: disabled,
          })}
        >
          <div className={style.thumb} />
        </div>
        {layout !== 'horizontal' && label && <span className={style.label}>{label}</span>}
      </div>
      {description && (
        <div id={descriptionId} className={style.description} onClick={handleDescriptionClick}>
          {description}
        </div>
      )}
    </div>
  );
};
