import { IconProps, defaultStrokeIconProps } from './props';

// Hugeicons "clapping-02" (@hugeicons/core-free-icons 4.3.5, MIT), stroke 2 instead of 1.5, ink box centred.
// Front hand with four fingers and its thumb, second hand behind with its thumb and two fingers showing. Part of the five-icon rating family.
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
      <path d="M20.29 16.6l-2.65 2.78c-1.23 1.29 -1.85 1.94 -2.53 2.26c-1.04 .49 -2.22 .49 -3.26 .01c-.68 -.32 -1.29 -.96 -2.52 -2.25c-.65 -.68 -.97 -1.01 -1.2 -1.4c-.36 -.59 -.57 -1.26 -.62 -1.95c-.03 -.46 .03 -.93 .16 -1.88l.58 -4.18c.09 -.64 .58 -1.14 1.2 -1.21c.8 -.09 1.51 .56 1.5 1.41l0 1.93l4.52 -4.74c.47 -.49 1.23 -.49 1.7 0c.47 .49 .47 1.29 0 1.79" />
      <path d="M17.17 9.16l1.14 -1.19c.47 -.49 1.23 -.49 1.7 0c.47 .49 .47 1.29 0 1.79l-1.14 1.19" />
      <path d="M17.17 9.16l-2.56 2.68" />
      <path d="M18.88 10.94c.47 -.49 1.23 -.49 1.7 0c.47 .49 .47 1.29 0 1.79l-1.14 1.19" />
      <path d="M18.88 10.94l-2.56 2.68" />
      <path d="M19.73 17.19l1.42 -1.49c.47 -.49 .47 -1.29 0 -1.79c-.47 -.49 -1.23 -.49 -1.7 0" />
      <path d="M19.44 13.92l-1.42 1.49" />
      <path d="M12.27 4.19c.48 -.5 .48 -1.32 0 -1.82c-.48 -.5 -1.25 -.5 -1.72 0l-4.57 4.82l0 -1.97c0 -.86 -.71 -1.53 -1.52 -1.44c-.62 .07 -1.12 .58 -1.21 1.24l-.58 4.25c-.13 .97 -.2 1.45 -.17 1.91c.05 .71 .26 1.39 .62 1.99c.24 .39 .56 .74 1.21 1.42c.13 .14 .26 .27 .37 .39" />
      <path d="M12.27 4.19l1.15 -1.21c.48 -.5 1.25 -.5 1.72 0c.48 .5 .48 1.32 0 1.82" />
      <path d="M12.27 4.19l-1.76 1.86" />
    </svg>
  );
};
