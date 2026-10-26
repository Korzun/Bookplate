import { IconProps, defaultFilledIconProps } from './props';

// Drawn by Simon Korzun for Bookplate (Sketch, 20-unit art board scaled to 24): a filled outline of a fist with four
// folded fingers facing left and the thumb pointing down. Outline 1.8 units, finger lines 0.9, ink box centred on (12, 12).
export const ThumbDownIcon = (props: IconProps) => {
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
      <path d="M5.99 9.24c-.18 -.34 -.29 -.73 -.29 -1.14c0 -.95 .55 -1.77 1.35 -2.16c-.1 -.26 -.15 -.55 -.15 -.84c0 -1.33 1.07 -2.4 2.4 -2.4h5.4c2.32 0 4.2 1.88 4.2 4.2v7.91c0 .57 -.12 1.13 -.34 1.65l-1.37 3.2c-.43 1 -1.41 1.64 -2.49 1.64c-1.55 0 -2.62 -1.55 -2.07 -2.99l.68 -1.81h-5.2c-1.33 0 -2.4 -1.07 -2.4 -2.4c0 -.41 .1 -.8 .29 -1.14c-.54 -.44 -.89 -1.11 -.89 -1.86c0 -.75 .35 -1.42 .89 -1.86M7.5 11.7h2.1c.5 0 .9 .4 .9 .9c0 .5 -.4 .9 -.9 .9h-1.5c-.33 0 -.6 .27 -.6 .6c0 .33 .27 .6 .6 .6h6.07c.84 0 1.42 .84 1.12 1.62l-.98 2.62c-.1 .27 .1 .56 .39 .56c.36 0 .69 -.22 .84 -.55l1.37 -3.2c.13 -.3 .19 -.62 .19 -.95v-7.91c0 -1.33 -1.07 -2.4 -2.4 -2.4h-5.4c-.33 0 -.6 .27 -.6 .6c0 .33 .27 .6 .6 .6h.3c.5 0 .9 .4 .9 .9c0 .5 -.4 .9 -.9 .9h-1.5c-.33 0 -.6 .27 -.6 .6c0 .33 .27 .6 .6 .6h1.5c.5 0 .9 .4 .9 .9c0 .5 -.4 .9 -.9 .9h-2.1c-.33 0 -.6 .27 -.6 .6c0 .33 .27 .6 .6 .6" />
    </svg>
  );
};
