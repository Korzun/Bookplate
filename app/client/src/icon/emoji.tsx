import { useId } from 'react';

import { IconProps } from './props';

const defaultProps = { className: '', height: 24, width: 24 };

type EmojiIconProps = IconProps & {
  /** The emoji, with U+FE0F where a character has a text presentation too. */
  glyph: string;
};

/**
 * An emoji drawn as a flat silhouette in the current text colour. The glyph is
 * set in the platform's colour emoji font inside a 24-unit view box, and an SVG
 * filter floods `currentColor` through its alpha, so the same component follows
 * the muted and brand colours in both themes like any stroke icon. Font size
 * 18 fills the box the way the 24-unit icon set does, measured in WebKit and
 * Chromium. The filter id comes from `useId`, so several instances can share a
 * page.
 */
export const EmojiIcon = (props: EmojiIconProps) => {
  const {
    'aria-hidden': ariaHidden,
    'aria-label': ariaLabel,
    className,
    glyph,
    height,
    role,
    width,
  } = { ...defaultProps, ...props };
  const filterId = useId();

  return (
    <svg
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      className={className}
      height={height}
      role={role}
      viewBox="0 0 24 24"
      width={width}
      xmlns="http://www.w3.org/2000/svg"
    >
      <filter
        id={filterId}
        filterUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="24"
        height="24"
        colorInterpolationFilters="sRGB"
      >
        <feFlood floodColor="currentColor" result="flood" />
        <feComposite in="flood" in2="SourceAlpha" operator="in" />
      </filter>
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="18"
        fontFamily="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
        filter={`url(#${filterId})`}
      >
        {glyph}
      </text>
    </svg>
  );
};
