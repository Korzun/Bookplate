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
      //
      // The inset belongs to whatever is topmost. When that is this `<main>` the
      // fallback applies; when the admin's library-switcher band sits above it
      // (`router/nav-layout-style`), the band has already spent the inset and sets
      // `--page-top-inset` to zero on everything after it. Counting it here as
      // well left a status-bar-sized hole between the band's rule and the first
      // row of content in the installed app — and nowhere else, because in a
      // Safari tab the inset is zero, which is how it went unnoticed.
      paddingTop: `calc(${theme.space.xxxxxl} + var(--page-top-inset, env(safe-area-inset-top)))`,
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
    // ONE ROW: the page's own header content leads, the actions bar trails.
    // `/add` is the case that needs both — its Upload/Request toggle on the
    // left, its "Actions" trigger on the right — and the bar's own internal
    // spacer keeps that trigger hard right however much room it is given.
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    // Both slots share the leftover width rather than either one owning it:
    // alone, the search bar or the actions bar takes the full row exactly as
    // it did as a child of `<main>`; together, the toggle takes the space the
    // actions do not need. `minWidth: 0` lets a wide child shrink instead of
    // pushing the row past the content column.
    '& > *': {
      flexGrow: 1,
      minWidth: 0,
    },
    // Mobile reserves nothing: the actions live in the floating menu
    // (`PageActionsMenu`) rather than in this row, and screen height is too
    // dear to hold open a row for chrome that is not there. `contents` makes
    // the row itself vanish from the layout, so whatever it holds — a search
    // bar — lands as a direct child of `<main>`, exactly where it sat before
    // this row existed.
    [theme.breakpoint.mobile]: {
      display: 'contents',
      // `contents` hands these children straight to `<main>`, whose flex
      // direction is COLUMN — leaving `flexGrow` on would stretch a search bar
      // down the whole page rather than across it.
      '& > *': {
        flexGrow: 0,
      },
    },
  },
  // Mobile-only row holding the back button and the page actions menu. STICKY,
  // not fixed: it starts in the page's flow — under the admin's library-switcher
  // band when there is one — scrolls up with the page like everything else, and
  // pins at `floatingControlTopBase` once it gets there. Both halves of that
  // (riding up with the band, then holding) used to be done by hand: the
  // controls were `position: fixed` and a scroll listener published the scroll
  // offset for the stylesheet to subtract from their `top`. Fixed chrome whose
  // `top` is rewritten from scroll events lags the compositor on iOS and jitters
  // for the whole ride; sticky positioning is the same motion, done by the
  // scroller itself.
  //
  // Where the row rests before it pins: `floatingControlsGap` below the top of
  // whatever is above it — the status-bar inset on a page with nothing above,
  // or the band's rule, which sets the gap smaller (`router/nav-layout-style`).
  // `<main>`'s top padding is larger than either gap, so the margin pulls the
  // row up into that padding by the difference; the content that follows keeps
  // its own `gap` from the row.
  controlsRow: {
    position: 'sticky',
    top: theme.layout.floatingControlTopBase,
    zIndex: theme.zIndex.sticky,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: `calc(var(--floating-controls-gap, ${theme.space.xxxxl}) - ${theme.space.xxxxxl})`,
    // The buttons sit `space.lg` from the screen edge, inside a gutter of
    // `space.xxl`, so the row reaches out past the gutter by the difference.
    marginLeft: `calc(${theme.space.lg} - ${theme.space.xxl})`,
    marginRight: `calc(${theme.space.lg} - ${theme.space.xxl})`,
    // The row spans the width between the buttons; taps there must reach the
    // content scrolling under it.
    pointerEvents: 'none',
    '& > *': {
      pointerEvents: 'auto',
    },
    // Desktop has the actions bar in the header row and no back button.
    [theme.breakpoint.normal]: {
      display: 'none',
    },
  },
}));
