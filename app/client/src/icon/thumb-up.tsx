import { IconProps, defaultFilledIconProps } from './props';

// Drawn by Simon Korzun for Bookplate: the thumb-down rotated 180° (Tabler's own thumb-up/thumb-down relationship), so
// the fist faces right with the thumb up. Filled outline, 1.8-unit outline and 0.9-unit finger lines, centred on (12, 12).
export const ThumbUpIcon = (props: IconProps) => {
  const {
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    className,
    fill,
    height,
    role,
    width,
  } = { ...defaultFilledIconProps, ...props };

  return (
    <svg
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      className={className}
      fill={fill}
      height={height}
      role={role}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18.01 14.76c.18 .34 .29 .73 .29 1.14c0 .95 -.55 1.77 -1.35 2.16c.1 .26 .15 .55 .15 .84c0 1.33 -1.07 2.4 -2.4 2.4h-5.4c-2.32 0 -4.2 -1.88 -4.2 -4.2v-7.91c0 -.57 .12 -1.13 .34 -1.65l1.37 -3.2c.43 -1 1.41 -1.64 2.49 -1.64c1.55 0 2.62 1.55 2.07 2.99l-.68 1.81h5.2c1.33 0 2.4 1.07 2.4 2.4c0 .41 -.1 .8 -.29 1.14c.54 .44 .89 1.11 .89 1.86c0 .75 -.35 1.42 -.89 1.86M16.5 12.3h-2.1c-.5 0 -.9 -.4 -.9 -.9c0 -.5 .4 -.9 .9 -.9h1.5c.33 0 .6 -.27 .6 -.6c0 -.33 -.27 -.6 -.6 -.6h-6.07c-.84 0 -1.42 -.84 -1.12 -1.62l.98 -2.62c.1 -.27 -.1 -.56 -.39 -.56c-.36 0 -.69 .22 -.84 .55l-1.37 3.2c-.13 .3 -.19 .62 -.19 .95v7.91c0 1.33 1.07 2.4 2.4 2.4h5.4c.33 0 .6 -.27 .6 -.6c0 -.33 -.27 -.6 -.6 -.6h-.3c-.5 0 -.9 -.4 -.9 -.9c0 -.5 .4 -.9 .9 -.9h1.5c.33 0 .6 -.27 .6 -.6c0 -.33 -.27 -.6 -.6 -.6h-1.5c-.5 0 -.9 -.4 -.9 -.9c0 -.5 .4 -.9 .9 -.9h2.1c.33 0 .6 -.27 .6 -.6c0 -.33 -.27 -.6 -.6 -.6" />
    </svg>
  );
};
