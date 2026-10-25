import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): ASL "I love you" — index and
// little finger up, middle and ring folded to stubs, thumb leaving the index base at 35° like the clap's. Part of the five-icon rating family.
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
      <path d="M11.5 11.5v-6a1.5 1.5 0 0 0 -3 0v5.8l-.27 .34l-2.01 -2.87a1.5 1.5 0 0 0 -2.46 1.72l2.01 2.87l2.73 .34v3.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3 -3v-10a1.5 1.5 0 0 0 -3 0v4.5" />
      <path d="M11.5 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M14.5 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
    </svg>
  );
};
