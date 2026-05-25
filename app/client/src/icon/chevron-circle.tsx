import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=circle-chevron-right
export const ChevronCircleIcon = (props: IconProps) => {
  const { className, fill, stroke, height, width, strokeWidth } = {
    ...defaultStrokeIconProps,
    ...props,
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      stroke-width={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M11 9l3 3l-3 3" />
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
    </svg>
  );
};
