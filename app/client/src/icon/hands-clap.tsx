import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler stroke style (see https://tabler.io/icons/icon/hand-stop):
// a front palm, the second palm meeting it from behind, two motion strokes.
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
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M5.5 13.5v-5a1.5 1.5 0 0 1 3 0v3.5" />
      <path d="M8.5 11.5v-5a1.5 1.5 0 0 1 3 0v5" />
      <path d="M11.5 11.5v-4a1.5 1.5 0 0 1 3 0v8a5.5 5.5 0 0 1 -5.5 5.5h-.5a4.5 4.5 0 0 1 -3.9 -2.25l-2 -3.5a1.3 1.3 0 0 1 2.2 -1.4l.7 .8" />
      <path d="M14.5 11l1.2 -2.7a1.5 1.5 0 0 1 2.75 1.2l-1.3 2.9" />
      <path d="M17.3 12.5l1 -1.7a1.5 1.5 0 0 1 2.6 1.5l-2.7 5.2a6 6 0 0 1 -3.3 3" />
      <path d="M19 5l.9 -1.4" />
      <path d="M20.4 7.4l1.3 -.4" />
    </svg>
  );
};
