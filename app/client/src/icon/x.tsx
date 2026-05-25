import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=x
export const XIcon = (props: IconProps) => {
  const { className, fill, height, width, stroke, strokeWidth } = {
    ...defaultStrokeIconProps,
    ...props,
  };

  return (
    <svg
      className={className}
      fill={fill}
      height={height}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M18 6l-12 12" />
      <path d="M6 6l12 12" />
    </svg>
  );
};
