import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): ASL "I love you" — index and little
// finger up, middle and ring folded to stubs, thumb at 40° to the fingers joining the palm edge two units below the index base,
// its outer edge running into the palm edge, the same junction as the clap's front thumb. Part of the five-icon rating family.
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
      <path d="M11.15 11.5v-6a1.5 1.5 0 0 0 -3 0v8l-1.61 -1.92a1.5 1.5 0 0 0 -2.3 1.93l3.91 3.56a3 3 0 0 0 3 2.92h6a3 3 0 0 0 3 -3v-10a1.5 1.5 0 0 0 -3 0v4.5" />
      <path d="M11.15 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M14.15 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
    </svg>
  );
};
