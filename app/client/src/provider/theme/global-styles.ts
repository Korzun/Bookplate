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
    '@keyframes theme-slide-in-down': {
      from: { opacity: 0, transform: 'translateY(-0.4rem)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    '@keyframes theme-slide-out-up': {
      from: { opacity: 1, transform: 'translateY(0)' },
      to: { opacity: 0, transform: 'translateY(-0.4rem)' },
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
