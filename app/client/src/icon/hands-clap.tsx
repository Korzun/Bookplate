import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler stroke style (see https://tabler.io/icons/icon/hand-stop):
// two mirrored palms, heels meeting on the centre line, fingers and thumbs
// fanning outward, three motion strokes above the contact point.
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
      <path d="M5.68 14.71L4.83 10.71A1.3 1.3 0 0 1 7.38 10.16L8.03 13.25" />
      <path d="M7.38 10.16L7.19 9.28A1.3 1.3 0 0 1 9.75 8.74L12 19.35" />
      <path d="M5.68 14.71L4.50 13.95A0.81 0.81 0 0 0 3.62 15.31L6.28 17.53L6.89 20.44" />
      <path d="M18.32 14.71L19.17 10.71A1.3 1.3 0 0 0 16.62 10.16L15.97 13.25" />
      <path d="M16.62 10.16L16.81 9.28A1.3 1.3 0 0 0 14.25 8.74L12 19.35" />
      <path d="M18.32 14.71L19.50 13.95A0.81 0.81 0 0 1 20.38 15.31L17.72 17.53L17.11 20.44" />
      <path d="M12 3v1.8" />
      <path d="M9.3 3.9l.6 .9" />
      <path d="M14.7 3.9l-.6 .9" />
    </svg>
  );
};
