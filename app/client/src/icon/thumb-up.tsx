import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): side view of a fist with four
// knuckle curls tapering one unit per row toward the little finger, 3.5-unit thumb bent 15° toward them, hand tilted 5°.
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
      <path d="M16.32 7.76l-6.82 1.51l.69 -3.94a1.5 1.5 0 0 0 -2.95 -.52l-.69 3.94l-.51 1.92l.61 6.97a3 3 0 0 0 3.25 2.73l4.48 -.39a1.5 1.5 0 0 0 -.26 -2.99l-3.49 .31" />
      <path d="M16.32 7.76a1.5 1.5 0 0 1 .26 2.99l-3.49 .31" />
      <path d="M15.59 10.84a1.5 1.5 0 0 1 .26 2.99l-3.49 .31" />
      <path d="M14.85 13.91a1.5 1.5 0 0 1 .26 2.99l-3.49 .31" />
    </svg>
  );
};
