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
  // The page's header row — the desktop actions bar's home, and the space
  // every other page holds open so that moving between them does not shift
  // the content under the cursor. `/add`'s two views are the case that makes
  // it obvious: only Upload publishes actions, so the toggle jumped every
  // time you switched.
  //
  // MEASURED, not derived, and the one number to tune here: a `Button` takes
  // its height from its own line box, which is the body font's `normal`
  // line-height and therefore not something the tokens can predict. This
  // floor only has to CLEAR that height — a floor above it makes every header
  // row exactly this tall, actions or not, which is the whole point. Drop
  // below it and the pages with actions grow past the ones without, quietly
  // giving back the consistency this buys.
  headerRow: {
    minHeight: '2.25rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    // Only relevant to a page that has both an actions bar and its own header
    // content; nothing does today.
    gap: theme.space.md,
    // Mobile reserves nothing: the actions live in the floating menu
    // (`PageActionsMenu`) rather than in this row, and screen height is too
    // dear to hold open a row for chrome that is not there. `contents` makes
    // the row itself vanish from the layout, so whatever it holds — a search
    // bar — lands as a direct child of `<main>`, exactly where it sat before
    // this row existed.
    [theme.breakpoint.mobile]: {
      display: 'contents',
    },
  },
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
