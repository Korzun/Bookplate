import { createUseStyles, type Theme } from '~/provider/theme';

const DISC_SIZE = '36px';

export const useStyle = createUseStyles((theme: Theme) => ({
  // A full-width, viewport-fixed rail just below the status bar, so the disc is
  // centred under the notch on every page. Non-interactive: it only ever
  // follows the finger, never takes it.
  root: {
    position: 'fixed',
    top: 'env(safe-area-inset-top)',
    left: 0,
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    // Above the page and the status-bar fade, level with the floating controls.
    zIndex: theme.zIndex.sticky,
    [theme.breakpoint.normal]: {
      display: 'none',
    },
  },
  // Starts tucked fully above the rail (under the status bar, which `TopFade`
  // blurs) and is pulled down by `--pull-offset`, set from the hook's overscroll
  // distance. The same glass as the nav capsule, so it reads as chrome.
  disc: {
    ...theme.recipe.glass,
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: theme.radius.circle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.color.text.primary,
    transform: `translateY(calc(var(--pull-offset, 0px) - 100% - ${theme.space.md}))`,
    opacity: 'var(--pull-opacity, 0)',
    // Snapping back (release, or the refresh settling) eases; while the finger
    // is down the disc tracks it directly, which `following` switches on.
    transition: 'transform 200ms ease-out, opacity 200ms ease-out',
  },
  following: {
    transition: 'none',
  },
  // The chevron points down while pulling and flips to point up once the pull
  // has armed: "let go now".
  arrow: {
    transform: 'rotate(90deg)',
    transition: 'transform 200ms ease-out',
  },
  arrowArmed: {
    transform: 'rotate(-90deg)',
  },
  spinner: {
    ...theme.recipe.spinner,
    height: '1.25rem',
    width: '1.25rem',
  },
}));
