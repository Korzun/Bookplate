import cx from 'classnames';
import { ComponentType, useCallback } from 'react';

import { IconProps, SpinnerIcon } from '~/icon';

import { ButtonType, ButtonTypeValue, useStyle } from './style';

type ButtonVariant =
  | { danger?: false; success?: false }
  | { danger: true; success?: never }
  | { success: true; danger?: never };

type ButtonProps = React.PropsWithChildren<
  {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    prefix?: ComponentType<IconProps>;
    suffix?: ComponentType<IconProps>;
    tabIndex?: number;
    title?: string;
    type?: ButtonTypeValue;
  } & ButtonVariant
>;
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

  const loadingIcon = loading ? <SpinnerIcon className={styles.spinner} /> : null;
  const prefixIcon = !loading && Prefix ? <Prefix className={styles.buttonIcon} /> : null;
  const suffixIcon = !loading && Suffix ? <Suffix className={styles.buttonIcon} /> : null;

  return (
    <div
      role="button"
      tabIndex={tabIndex}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={title}
    >
      {loadingIcon}
      {prefixIcon}
      {children}
      {suffixIcon}
    </div>
  );
};

export type { ButtonTypeValue };
