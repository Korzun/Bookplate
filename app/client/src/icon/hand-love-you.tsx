import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): ASL "I love you" — index and little
// finger up, middle and ring folded to stubs, thumb at 35° to the fingers with its inner edge meeting the index base and its outer
// edge running into the palm edge, the same junction as the clap's front thumb. Part of the five-icon rating family.
export const HandLoveYouIcon = (props: IconProps) => {
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
      <path d="M11.05 11.5v-6a1.5 1.5 0 0 0 -3 0v6l-1.43 -2.05a1.5 1.5 0 0 0 -2.46 1.72l3.89 4.61v1.22a3 3 0 0 0 3 3h6a3 3 0 0 0 3 -3v-10a1.5 1.5 0 0 0 -3 0v4.5" />
      <path d="M11.05 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M14.05 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
    </svg>
  );
};
