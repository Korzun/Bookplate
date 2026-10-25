import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler stroke style (see https://tabler.io/icons/icon/hand-love-you):
// thumb and index form the ring, middle, ring and little finger stand up.
export const HandOkIcon = (props: IconProps) => {
  const {
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    className,
    fill,
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
      fill={fill}
      height={height}
      role={role}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 13v-8.5a1.5 1.5 0 0 1 3 0v6.5" />
      <path d="M14 11v-5a1.5 1.5 0 0 1 3 0v5" />
      <path d="M17 11v-2.5a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1 -6.5 6.5h-1a5 5 0 0 1 -5 -5v-.5" />
      <path d="M4 12.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0" />
    </svg>
  );
};
