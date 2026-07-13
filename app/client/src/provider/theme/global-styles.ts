import { createUseStyles } from 'react-jss';

import type { Theme } from './theme';

const useGlobalStyles = createUseStyles((theme: Theme) => ({
  '@global': {
    html: {
      backgroundColor: theme.color.bg.page,
    },
    body: {
      fontFamily: theme.fontFamily.body,
      backgroundColor: theme.color.bg.page,
      color: theme.color.text.primary,
      colorScheme: theme.colorScheme,
      minHeight: '100dvh',
      fallbacks: {
        minHeight: '100vh',
      },
      '-webkit-text-size-adjust': '100%',
      '-webkit-font-smoothing': 'antialiased',
      '-moz-osx-font-smoothing': 'grayscale',
    },
    'body:has(dialog[open])': {
      overflow: 'hidden',
    },
    'a, button': {
      '-webkit-tap-highlight-color': 'transparent',
    },
    // iOS Safari auto-zooms when a form control with a font-size below 16px is
    // focused. Enforce a 16px floor on mobile so focusing an input never zooms.
    // Controls that set their own class-level font-size out-specify this rule and
    // handle the mobile breakpoint themselves (see select, search-bar, etc.).
    [theme.breakpoint.mobile]: {
      'input, textarea, select': {
        fontSize: '16px',
      },
    },
    '@keyframes theme-rotation': {
      '0%': { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(360deg)' },
    },
    '@keyframes theme-slide-in': {
      from: { opacity: 0, transform: 'translateY(0.4rem)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    '@keyframes theme-slide-out': {
      from: { opacity: 1, transform: 'translateY(0)' },
      to: { opacity: 0, transform: 'translateY(0.4rem)' },
    },
    // Mobile toasts rest just above the bottom nav and sit behind it (lower
    // z-index), so a full-height rise makes them appear to slide out from
    // underneath the nav and settle above it; exiting reverses back under it.
    '@keyframes theme-slide-in-up': {
      from: { opacity: 0, transform: 'translateY(100%)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    '@keyframes theme-slide-out-down': {
      from: { opacity: 1, transform: 'translateY(0)' },
      to: { opacity: 0, transform: 'translateY(100%)' },
    },
  },
}));

export function useThemeGlobalStyles() {
  useGlobalStyles();
}

export function GlobalStyles() {
  useThemeGlobalStyles();
  return null;
}
