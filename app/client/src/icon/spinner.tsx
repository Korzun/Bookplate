import { IconProps, defaultStrokeIconProps } from './props';

export const SpinnerIcon = (props: IconProps) => {
  const { className, stroke, strokeWidth, height, width } = { ...defaultStrokeIconProps, ...props };

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 24 24"
      stroke={stroke}
      fill="none"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12,1 C18,1 23,6 23,12" />
    </svg>
  );
};
