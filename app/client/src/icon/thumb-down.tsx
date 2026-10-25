import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (cf. https://tabler.io/icons?icon=thumb-down, https://tabler.io/icons?icon=hand-stop):
// 3-unit finger tubes, round caps/joins, stroke 2. Thumb-up rotated 180° (same hand). Part of the five-icon rating family.
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
      <path d="M8.35 17.21l7.05 -2.57l1.88 5.17a1.5 1.5 0 0 0 2.82 -1.03l-4.96 -13.63a3 3 0 0 0 -3.85 -1.79l-6.11 2.22a1.5 1.5 0 0 0 1.03 2.82l3.29 -1.2" />
      <path d="M8.35 17.21a1.5 1.5 0 0 1 -1.03 -2.82l3.29 -1.2" />
      <path d="M9.67 13.53l-3.29 1.2a1.5 1.5 0 0 1 -1.03 -2.82l3.29 -1.2" />
      <path d="M9.11 10.54l-3.29 1.2a1.5 1.5 0 0 1 -1.03 -2.82l3.29 -1.2" />
    </svg>
  );
};
