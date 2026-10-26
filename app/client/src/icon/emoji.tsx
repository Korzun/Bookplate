import { useId } from 'react';

import { IconProps } from './props';

const defaultProps = { className: '', height: 24, width: 24 };

type EmojiIconProps = IconProps & {
  /** The emoji, with U+FE0F where a character has a text presentation too. */
  glyph: string;
};

/**
 * An emoji drawn as a flat silhouette in the current text colour. The glyph is
 * set in the platform's colour emoji font inside a 24-unit view box and used as
 * an alpha mask over a `currentColor` rectangle, so the same component follows
 * the muted and brand colours in both themes like any stroke icon, including
 * on hover and selection. (An SVG filter flooding `currentColor` through the
 * glyph looked the same at first paint, but WebKit does not repaint a filter
 * when the inherited colour changes; a mask over ordinary paint does.) Font
 * size 18 fills the box the way the 24-unit icon set does, measured in WebKit
 * and Chromium. The mask id comes from `useId`, so several instances can share
 * a page.
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
  const maskId = useId();

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
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="24"
        height="24"
        style={{ maskType: 'alpha' }}
      >
        <text
          x="12"
          y="12"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="18"
          fontFamily="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
        >
          {glyph}
        </text>
      </mask>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
};
