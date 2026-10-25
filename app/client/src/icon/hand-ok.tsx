import { IconProps, defaultStrokeIconProps } from './props';

// Hugeicons "ok-finger" (@hugeicons/core-free-icons 4.3.5, MIT), stroke 2 instead of 1.5, open wrist closed with a palm heel
// and ink box centred. Thumb and index meet tip to tip in the ring. Part of the five-icon rating family.
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
      <path d="M14.81 19.8c-.21 2.1 -8.21 2.3 -8.61 .1c-.15 -.6 -.3 -1.2 -.52 -1.66l-.29 -.6c-.59 -1.19 -.89 -2.5 -.89 -3.83v-5.12c0 -.79 .63 -1.43 1.41 -1.43c.77 0 1.4 .64 1.4 1.43" />
      <path d="M14.81 19.8c.09 -.4 1.29 -.35 2.17 -.87c1.12 -.65 2.01 -1.7 2.43 -2.97c.27 -.83 -.48 -1.55 -1.38 -1.55c-.9 0 -1.66 .78 -2.31 1.38c-.1 .1 -.2 .17 -.28 .22c-1.27 .81 -2.96 -.17 -2.96 -1.6c0 -1.44 1.69 -2.42 2.96 -1.61c.32 .17 .58 .39 .79 .62c.47 .52 1.09 .99 1.81 .99c.91 0 1.68 -.74 1.4 -1.59c-.67 -2.12 -2.67 -3.65 -5.04 -3.65c-.99 0 -1.46 .28 -1.46 .28l2.14 -5c.38 -.93 -.3 -1.95 -1.28 -1.95c-.53 0 -1.01 .3 -1.25 .78l-2.42 4.93" />
      <path d="M10.13 8.21l-.45 .91" />
      <path d="M10.13 8.21v-3.33c0 -.79 -.63 -1.43 -1.41 -1.43c-.78 0 -1.41 .64 -1.41 1.43v3.81" />
      <path d="M7.31 8.69v3.33" />
    </svg>
  );
};
