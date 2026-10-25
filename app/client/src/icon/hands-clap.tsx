import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (finger and palm construction of https://tabler.io/icons?icon=hand-stop):
// front hand tilted 20°, second hand behind it tilted the other way, only its knuckle scallop and outer edge showing. Part of the five-icon rating family.
export const HandsClapIcon = (props: IconProps) => {
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
      <path d="M7.81 12.81l1.54 -4.23a1.5 1.5 0 0 1 2.82 1.03l-1.54 4.23" />
      <path d="M10.8 13.37l1.88 -5.17a1.5 1.5 0 0 1 2.82 1.03l-1.88 5.17" />
      <path d="M13.62 14.39l1.71 -4.7a1.5 1.5 0 0 1 2.82 1.03l-1.71 4.7" />
      <path d="M16.27 15.89l1.2 -3.29a1.5 1.5 0 0 1 2.82 1.03l-1.2 3.29a6 6 0 0 1 -7.69 3.59l-1.88 -.68a4 4 0 0 1 -2.39 -5.13l.68 -1.88" />
      <path d="M15.24 4.88l-.29 -.8a1.5 1.5 0 0 0 -2.82 1.03l-.34 -.94a1.5 1.5 0 0 0 -2.82 1.03a1.5 1.5 0 0 0 -2.82 1.03l.34 .94a1.5 1.5 0 0 0 -2.82 1.03l1.54 4.23" />
    </svg>
  );
};
