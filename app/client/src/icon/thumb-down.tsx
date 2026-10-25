import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): side view of a fist with four
// knuckle curls, thumb tube 6 units long. The thumb-up rotated 180°. Part of the five-icon rating family.
export const ThumbDownIcon = (props: IconProps) => {
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
      <path d="M7.21 15.58l7.09 -1.13l2.54 5.98a1.5 1.5 0 0 0 2.76 -1.17l-2.54 -5.98l.27 -1.14l-.97 -6.93a3 3 0 0 0 -3.39 -2.55l-7.43 1.04a1.5 1.5 0 0 0 .42 2.97l3.47 -.49" />
      <path d="M7.21 15.58a1.5 1.5 0 0 1 -.42 -2.97l3.47 -.49" />
      <path d="M6.79 12.61a1.5 1.5 0 0 1 -.42 -2.97l3.47 -.49" />
      <path d="M6.37 9.64a1.5 1.5 0 0 1 -.42 -2.97l3.47 -.49" />
    </svg>
  );
};
