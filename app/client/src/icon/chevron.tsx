import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=chevron-right
export const ChevronIcon = (props: IconProps) => {
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
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
};
