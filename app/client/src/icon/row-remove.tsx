import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=row-remove
export const RowRemoveIcon = (props: IconProps) => {
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
      <path d="M20 6v4a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1" />
      <path d="M10 16l4 4" />
      <path d="M10 20l4 -4" />
    </svg>
  );
};
