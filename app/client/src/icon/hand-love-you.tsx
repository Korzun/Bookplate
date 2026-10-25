import { IconProps, defaultStrokeIconProps } from './props';

// Drawn for Bookplate in the Tabler outline idiom (3-unit finger tubes, r=1.5 tips, stroke 2): ASL "I love you" — index and
// little finger up, middle and ring folded to stubs, thumb extended from the lower palm. Part of the five-icon rating family.
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
      <path d="M11.45 11.5v-6a1.5 1.5 0 0 0 -3 0v7.8l-.35 .24l-1.93 -2.3a1.5 1.5 0 0 0 -2.3 1.93l1.93 2.3l2.65 .24v1.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3 -3v-10a1.5 1.5 0 0 0 -3 0v4.5" />
      <path d="M11.45 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
      <path d="M14.45 11.5v-2a1.5 1.5 0 0 1 3 0v2" />
    </svg>
  );
};
