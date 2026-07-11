import cx from 'classnames';
import { ComponentType, useCallback } from 'react';

import { IconProps, SpinnerIcon } from '~/icon';

import { ButtonType, ButtonTypeValue, ButtonRadius, ButtonRadiusValue, useStyle } from './style';

type ButtonVariant =
  | { danger?: boolean; success?: false | undefined }
  | { success?: boolean; danger?: false | undefined };

type ButtonProps = React.PropsWithChildren<
  {
    className?: string;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    prefix?: ComponentType<IconProps>;
    radius?: ButtonRadiusValue;
    suffix?: ComponentType<IconProps>;
    tabIndex?: number;
    title?: string;
    type?: ButtonTypeValue;
  } & ButtonVariant
>;
export const Button = ({
  children,
  className: classNameProp,
  danger = false,
  disabled = false,
  loading = false,
  onClick = () => {},
  prefix: Prefix,
  radius = ButtonRadius.Background as ButtonRadiusValue,
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
    styles[radius],
    { [styles.danger]: danger },
    { [styles.loading]: loading },
    { [styles.disabled]: disabled },
    { [styles.success]: success },
    classNameProp
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
      if (!disabled && !loading && (event.key === 'Enter' || event.key === ' ')) {
        event.stopPropagation();
        onClick();
      }
    },
    [loading, disabled, onClick]
  );

  const nonInteractive = disabled || loading;

  const loadingIcon = loading ? <SpinnerIcon className={styles.spinner} /> : null;
  const prefixIcon = !loading && Prefix ? <Prefix className={styles.buttonIcon} /> : null;
  const suffixIcon = !loading && Suffix ? <Suffix className={styles.buttonIcon} /> : null;

  return (
    <div
      role="button"
      aria-disabled={nonInteractive || undefined}
      tabIndex={nonInteractive ? -1 : tabIndex}
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

export type { ButtonTypeValue, ButtonRadiusValue };
