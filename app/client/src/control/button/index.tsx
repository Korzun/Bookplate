import cx from 'classnames';
import { ComponentType, useCallback } from 'react';

import { IconProps, SpinnerIcon } from '~/icon';

import { ButtonType, ButtonTypeValue, useStyle } from './style';

type ButtonProps = React.PropsWithChildren<{
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  prefix?: ComponentType<IconProps>;
  suffix?: ComponentType<IconProps>;
  success?: boolean;
  tabIndex?: number;
  title?: string;
  type?: ButtonTypeValue;
}>;
export const Button = ({
  children,
  danger = false,
  disabled = false,
  loading = false,
  onClick = () => {},
  prefix: Prefix,
  suffix: Suffix,
  success = false,
  tabIndex,
  title,
  type = ButtonType.Default as ButtonTypeValue,
}: ButtonProps) => {
  const styles = useStyle();
  const className = cx(
    styles.root,
    styles[type],
    { [styles.danger]: danger },
    { [styles.loading]: loading },
    { [styles.disabled]: disabled },
    { [styles.success]: success }
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (!disabled && !loading) {
        event.stopPropagation();
        onClick();
      }
    },
    [loading, disabled, onClick]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation();
        onClick();
      }
    },
    [onClick]
  );

  return (
    <div
      role="button"
      tabIndex={tabIndex}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title}
    >
      {loading && <SpinnerIcon className={styles.spinner} />}
      {Prefix && <Prefix className={styles.buttonIcon} />}
      {children}
      {Suffix && <Suffix className={styles.buttonIcon} />}
    </div>
  );
};

export type { ButtonTypeValue };
