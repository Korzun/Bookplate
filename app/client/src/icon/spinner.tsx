import { IconProps, defaultStrokeIconProps } from './props';

export const SpinnerIcon = (props: IconProps) => {
  const {
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    className,
    height,
    role,
    stroke,
    strokeWidth,
    width,
  } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      className={className}
      fill="none"
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12,1 C18,1 23,6 23,12" />
    </svg>
  );
};
