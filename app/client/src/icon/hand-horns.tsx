import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons/icon/hand-love-you
// Adapted: the thumb is folded across the palm (rock horns), shifted 2 left to re-centre.
export const HandHornsIcon = (props: IconProps) => {
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
      <path d="M9 11.5v-1a1.5 1.5 0 0 1 3 0v1.5" />
      <path d="M15 12v-6.5a1.5 1.5 0 0 1 3 0v10.5a6 6 0 0 1 -6 6h-1a5 5 0 0 1 -5 -5v-4" />
      <path d="M12 10.5a1.5 1.5 0 0 1 3 0v1.5" />
      <path d="M6 13v-8.5a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M6 15h5a1.5 1.5 0 0 0 0 -3h-2" />
    </svg>
  );
};
