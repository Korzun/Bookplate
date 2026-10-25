import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): index and little finger up,
// middle and ring folded to stubs, thumb folded across below them. Part of the five-icon rating family.
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
      <path d="M9 12v-7.5a1.5 1.5 0 0 0 -3 0v13.5" />
      <path d="M9 12v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M12 12v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M15 12v-6a1.5 1.5 0 0 1 3 0v12a3 3 0 0 1 -3 3h-6a3 3 0 0 1 -3 -3" />
      <path d="M6 14h7.5a1.5 1.5 0 0 1 0 3h-7.5" />
    </svg>
  );
};
