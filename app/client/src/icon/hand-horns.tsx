import { IconProps, defaultStrokeIconProps } from './props';

// Adapted from https://tabler.io/icons?icon=hand-love-you (MIT): palm shortened by one unit and shifted .25 right
// so the ink box matches the other four rating icons. Part of the five-icon rating family.
export const HandHornsIcon = (props: IconProps) => {
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
      <path d="M8.25 13v-8.5a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M11.25 11.5v-1a1.5 1.5 0 0 1 3 0v1.5" />
      <path d="M14.25 10.5a1.5 1.5 0 0 1 3 0v1.5" />
      <path d="M17.25 12v-6.5a1.5 1.5 0 0 1 3 0v9.5a6 6 0 0 1 -6 6h-2h.21a6 6 0 0 1 -5.01 -2.7a69.74 69.74 0 0 1 -.2 -.3c-.31 -.48 -1.41 -2.39 -3.29 -5.73a1.5 1.5 0 0 1 .54 -2.02a1.87 1.87 0 0 1 2.28 .28l1.47 1.47" />
    </svg>
  );
};
