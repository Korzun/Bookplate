import { IconProps, defaultStrokeIconProps } from './props';

// https://tabler.io/icons?icon=list-check
export const ListCheckIcon = (props: IconProps) => {
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
      <path d="M3.5 5.5l1.5 1.5l2.5 -2.5" />
      <path d="M3.5 17.5l1.5 1.5l2.5 -2.5" />
      <path d="M11 6l9 0" />
      <path d="M11 12l9 0" />
      <path d="M11 18l9 0" />
    </svg>
  );
};
