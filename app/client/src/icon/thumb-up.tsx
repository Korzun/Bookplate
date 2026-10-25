import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (cf. https://tabler.io/icons?icon=thumb-up, https://tabler.io/icons?icon=hand-stop):
// 3-unit finger tubes, round caps/joins, stroke 2; fist with four knuckle curls, tilted 20°. Part of the five-icon rating family.
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
      <path d="M15.65 6.79l-7.05 2.57l-1.88 -5.17a1.5 1.5 0 0 0 -2.82 1.03l4.96 13.63a3 3 0 0 0 3.85 1.79l6.11 -2.22a1.5 1.5 0 0 0 -1.03 -2.82l-3.29 1.2" />
      <path d="M15.65 6.79a1.5 1.5 0 0 1 1.03 2.82l-3.29 1.2" />
      <path d="M14.33 10.47l3.29 -1.2a1.5 1.5 0 0 1 1.03 2.82l-3.29 1.2" />
      <path d="M14.89 13.46l3.29 -1.2a1.5 1.5 0 0 1 1.03 2.82l-3.29 1.2" />
    </svg>
  );
};
