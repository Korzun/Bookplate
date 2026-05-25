export type IconProps = {
  className?: string;
  fill?: string;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  width?: number;
};

const defaultIconProps = {
  className: '',
  height: 24,
  width: 24,
};

export const defaultFilledIconProps = {
  ...defaultIconProps,
  fill: 'currentColor',
};

export const defaultStrokeIconProps = {
  ...defaultIconProps,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
};
