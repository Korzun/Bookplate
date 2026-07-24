import cx from 'classnames';
import { ComponentType, useCallback } from 'react';
import { useFormStatus } from 'react-dom';

import { IconProps, SpinnerIcon } from '~/icon';

import { ButtonType, ButtonTypeValue, ButtonRadius, ButtonRadiusValue, useStyle } from './style';

type ButtonVariant =
  | { danger?: boolean; success?: false | undefined }
  | { success?: boolean; danger?: false | undefined };

type ButtonProps = React.PropsWithChildren<
  {
    className?: string;
    disabled?: boolean;
    form?: string;
    loading?: boolean;
    // Applies to the default (div) mode only. In submit mode it is ignored:
    // native form submission (driven by the associated <form>) fires instead.
    onClick?: () => void;
    prefix?: ComponentType<IconProps>;
    radius?: ButtonRadiusValue;
    submit?: boolean;
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
  form,
  loading = false,
  onClick = () => {},
  prefix: Prefix,
  radius = ButtonRadius.Background as ButtonRadiusValue,
  submit = false,
  suffix: Suffix,
  success = false,
  tabIndex,
  title,
  type = ButtonType.Default as ButtonTypeValue,
}: ButtonProps) => {
  const styles = useStyle();
  // Safe to call unconditionally: outside a <form> action, useFormStatus
  // returns a default { pending: false }. Only consulted in submit mode.
  const { pending } = useFormStatus();
  const busy = loading || (submit && pending);

  const className = cx(
    styles.root,
    styles[type],
    styles[radius],
    { [styles.danger]: danger },
    { [styles.loading]: busy },
    { [styles.disabled]: disabled },
    { [styles.success]: success },
    classNameProp
  );

  const loadingIcon = busy ? <SpinnerIcon className={styles.spinner} /> : null;
  const prefixIcon = !busy && Prefix ? <Prefix className={styles.buttonIcon} /> : null;
  const suffixIcon = !busy && Suffix ? <Suffix className={styles.buttonIcon} /> : null;

  // Hoisted above the `if (submit)` branch (rather than left after the early
  // return, as in the naive version) so hook order never depends on the
  // `submit` branch taken during a given render. Both hooks are cheap and
  // simply unused in submit mode.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (!disabled && !busy) {
        event.stopPropagation();
        onClick();
      }
    },
    [busy, disabled, onClick]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!disabled && !busy && (event.key === 'Enter' || event.key === ' ')) {
        event.stopPropagation();
        onClick();
      }
    },
    [busy, disabled, onClick]
  );

  if (submit) {
    return (
      <button
        type="submit"
        form={form}
        className={className}
        disabled={disabled || busy}
        title={title}
        tabIndex={tabIndex}
      >
        {loadingIcon}
        {prefixIcon}
        {children}
        {suffixIcon}
      </button>
    );
  }

  const nonInteractive = disabled || busy;

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
