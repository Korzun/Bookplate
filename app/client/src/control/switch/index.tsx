import cx from 'classnames';
import { ReactNode, useCallback, useId } from 'react';

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
  // Per-instance id so the description's aria target stays unique even when two
  // switches sharing a `name` mount at once (e.g. the device create + edit forms).
  const generatedId = useId();
  const descriptionId = description ? generatedId : undefined;

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

  const track = (
    <div className={cx(style.track, { [style.checked]: checked, [style.disabled]: disabled })}>
      <div className={style.thumb} />
    </div>
  );

  const descriptionEl = description ? (
    <div
      id={descriptionId}
      className={style.description}
      // In the horizontal layout the whole shaded row is a toggle target, so let
      // description clicks bubble up. Elsewhere the description stays inert helper text.
      onClick={layout === 'horizontal' ? undefined : handleDescriptionClick}
    >
      {description}
    </div>
  ) : null;

  const commonProps = {
    role: 'switch' as const,
    'aria-checked': checked,
    'aria-label': label ?? name,
    'aria-describedby': descriptionId,
    'aria-disabled': disabled,
    tabIndex: disabled ? -1 : 0,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
  };

  // Horizontal keeps the toggle in its own right-hand column so the description,
  // stacked under the label in the content column, never runs beneath it.
  if (layout === 'horizontal') {
    return (
      <div {...commonProps} className={cx(style.root, style.horizontal)}>
        <div className={style.content}>
          {label && <span className={style.label}>{label}</span>}
          {descriptionEl}
        </div>
        {track}
      </div>
    );
  }

  return (
    <div {...commonProps} className={style.root}>
      <div className={style.row}>
        {track}
        {label && <span className={style.label}>{label}</span>}
      </div>
      {descriptionEl}
    </div>
  );
};
