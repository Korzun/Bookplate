import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (finger and palm construction of https://tabler.io/icons?icon=hand-three-fingers):
// three raised fingers, thumb and index closed into a ring. Part of the five-icon rating family.
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
      <path d="M11 12v-7.5a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M14 12.5v-7a1.5 1.5 0 0 1 3 0v7" />
      <path d="M17 13v-5a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1 -6 6h-2a4 4 0 0 1 -4 -4v-1.5" />
      <path d="M11 12a3.5 3.5 0 1 0 -7 0a3.5 3.5 0 1 0 7 0" />
    </svg>
  );
};
