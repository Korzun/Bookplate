import { IconProps, defaultFilledIconProps } from './props';

// Drawn by Simon Korzun for Bookplate (Sketch, 20-unit art board scaled to 24, flipped as in the source): ASL "I love you",
// index and little finger up, middle and ring folded, thumb out to the right. Filled outline, 1.8 units with 0.9-unit finger
// lines, ink box centred on (12, 12).
export const HandLoveYouIcon = (props: IconProps) => {
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
      <path d="M11.7 5.4v.68c-.19 -.05 -.39 -.08 -.6 -.08c-.57 0 -1.09 .2 -1.5 .53c-.41 -.33 -.93 -.53 -1.5 -.53c-.23 0 -.45 .03 -.65 .09c-.23 -1.08 -1.19 -1.89 -2.35 -1.89c-1.33 0 -2.4 1.07 -2.4 2.4v10.2c0 2.32 1.88 4.2 4.2 4.2h7.08c1.44 0 2.77 -.73 3.54 -1.95l3.31 -5.19c.31 -.48 .47 -1.04 .47 -1.61c0 -2.2 -2.81 -3.12 -4.11 -1.34l-.69 .95v-6.46c0 -1.33 -1.07 -2.4 -2.4 -2.4c-1.33 0 -2.4 1.07 -2.4 2.4M14.7 5.4v8.31c0 1.16 1.49 1.65 2.17 .71l1.78 -2.44c.27 -.37 .85 -.18 .85 .28c0 .23 -.07 .45 -.19 .64l-3.31 5.19c-.44 .69 -1.2 1.11 -2.02 1.11h-7.08c-1.33 0 -2.4 -1.07 -2.4 -2.4v-10.2c0 -.33 .27 -.6 .6 -.6c.33 0 .6 .27 .6 .6v3.9c0 .5 .4 .9 .9 .9c.5 0 .9 -.4 .9 -.9v-2.1c0 -.33 .27 -.6 .6 -.6c.33 0 .6 .27 .6 .6v2.1c0 .5 .4 .9 .9 .9c.5 0 .9 -.4 .9 -.9v-2.1c0 -.33 .27 -.6 .6 -.6c.33 0 .6 .27 .6 .6v2.1c0 .5 .4 .9 .9 .9c.5 0 .9 -.4 .9 -.9v-5.1c0 -.33 .27 -.6 .6 -.6c.33 0 .6 .27 .6 .6" />
    </svg>
  );
};
