import { createUseStyles } from 'react-jss';

import type { Theme } from './theme';

const useGlobalStyles = createUseStyles((theme: Theme) => ({
  '@global': {
    body: {
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: theme.color.bg.page,
      color: theme.color.text.primary,
      minHeight: '100vh',
    },
    'body:has(dialog[open])': {
      overflow: 'hidden',
    },
    '@keyframes theme-rotation': {
      '0%': { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(360deg)' },
    },
    '@keyframes theme-slide-in': {
      from: { opacity: 0, transform: 'translateY(0.4rem)' },
      to: { opacity: 1, transform: 'translateY(0)' },
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
