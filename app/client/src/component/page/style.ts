import { createUseStyles, type Theme } from '~/provider/theme';

export type PageTypeValue = 'default' | 'minimal';
export enum PageType {
  default = 'default',
  minimal = 'minimal',
}

export const useStyle = createUseStyles((theme: Theme) => ({
  [PageType.default]: {
    maxWidth: 800,
    margin: `${theme.space.xxxxxl} auto`,
    padding: `0 ${theme.space.xxl}`,
    display: 'flex',
    gap: theme.fontSize.md, // historical: 0.875rem flexbox gap
    flexDirection: 'column',
    [theme.breakpoint.mobile]: {
      margin: 0,
      // Top spacing the old static header used to provide (now that the desktop bar
      // is display:none on mobile); plus the notch inset, like the modal recipe.
      paddingTop: `calc(${theme.space.xxxxxl} + env(safe-area-inset-top))`,
      // Clears the floating mobile nav plus slack so the last row can always be
      // scrolled above both the nav and Safari's expanded URL bar. Nav height is the
      // shared theme.layout token (tune there); the extra space is this page's slack.
      paddingBottom: `calc(${theme.layout.navHeightMobile} + ${theme.space.xxxxxl} + ${theme.space.xxl} + env(safe-area-inset-bottom))`,
    },
  },
  [PageType.minimal]: {},
  // Mobile-only spacer so the fixed floating back/actions buttons don't overlap the
  // first child, with breathing room below them. Height is tunable during verification.
  topInset: {
    display: 'none',
    [theme.breakpoint.mobile]: {
      display: 'block',
      height: theme.space.xxxxxl,
    },
  },
}));
