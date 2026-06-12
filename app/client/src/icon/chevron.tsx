import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=chevron-right
export const ChevronIcon = (props: IconProps) => {
  const { 'aria-label': ariaLabel, className, fill, height, role, stroke, strokeWidth, width } = {
    ...defaultStrokeIconProps,
    ...props,
  };
  return (
    <svg
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
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
};
