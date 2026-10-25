import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): side view of a fist with four
// knuckle curls and a 4.5-unit thumb bent 15° toward them. The thumb-up rotated 180°. Part of the five-icon rating family.
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
      <path d="M8.08 15.74l6.82 -1.51l-.87 4.92a1.5 1.5 0 0 0 2.95 .52l.87 -4.92l.51 -1.92l-.61 -6.97a3 3 0 0 0 -3.25 -2.73l-7.47 .65a1.5 1.5 0 0 0 .26 2.99l3.49 -.31" />
      <path d="M8.08 15.74a1.5 1.5 0 0 1 -.26 -2.99l3.49 -.31" />
      <path d="M7.82 12.75a1.5 1.5 0 0 1 -.26 -2.99l3.49 -.31" />
      <path d="M7.55 9.76a1.5 1.5 0 0 1 -.26 -2.99l3.49 -.31" />
    </svg>
  );
};
