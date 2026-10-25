import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): side view of a fist with four
// knuckle curls, a 4.5-unit thumb leaning 5° back, the hand tilted 8°. Part of the five-icon rating family.
export const ThumbUpIcon = (props: IconProps) => {
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
      <path d="M16.04 7.87l-6.93 1.35l-1.12 -4.87a1.5 1.5 0 0 0 -2.92 .67l1.12 4.87l-.27 1.42l.97 6.93a3 3 0 0 0 3.39 2.55l7.43 -1.04a1.5 1.5 0 0 0 -.42 -2.97l-3.47 .49" />
      <path d="M16.04 7.87a1.5 1.5 0 0 1 .42 2.97l-3.47 .49" />
      <path d="M16.46 10.84a1.5 1.5 0 0 1 .42 2.97l-3.47 .49" />
      <path d="M16.88 13.81a1.5 1.5 0 0 1 .42 2.97l-3.47 .49" />
    </svg>
  );
};
