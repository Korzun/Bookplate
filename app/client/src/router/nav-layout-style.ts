import { scrollOffsetProperty } from '~/lib/use-scroll-offset-property';
import { createUseStyles, type Theme } from '~/provider/theme';

// The band's full height, which the page below it has to know in order to keep
// the fixed mobile controls off it. Derived from the tokens the band is built
// from rather than measured, so it tracks a change to the control instead of
// drifting from it: `space.xxl` above and below the switcher row, plus the
// band's own rule.
//
// The row is `layout.controlHeight` FLAT. `index.html` sets `box-sizing:
// border-box` on everything, so the `Select` trigger's padding and border are
// already inside that number — adding them again (which this did, for 18px too
// many) puts the controls below a band that is shorter than the arithmetic
// claims.
const bandHeight = (theme: Theme) =>
  `calc(env(safe-area-inset-top) + ${theme.space.xxl} * 2 + ${theme.layout.controlHeight} + 1px)`;

export const useStyle = createUseStyles((theme: Theme) => ({
  // The band: full-bleed, carrying the rule that separates the global picker
  // from the rest of the page. `border.section` is the token the page-level
  // section dividers already use (`page/book`, `page/series`), so this line
  // matches them in both themes rather than inventing a colour.
  switcherBand: {
    // The notch inset belongs to whatever is topmost, and that is now this
    // band rather than `component/page`'s `<main>` (which adds the same inset
    // for the pages that have nothing above them). Without it the picker sits
    // under the status bar in standalone, where `TopFade` blurs it.
    paddingTop: `calc(env(safe-area-inset-top) + ${theme.space.xxl})`,
    paddingBottom: theme.space.xxl,
    borderBottom: `1px solid ${theme.color.border.section}`,
    // The back button and the page actions menu are `position: fixed` against
    // the VIEWPORT, so they know nothing about this band and would sit on top
    // of it — which is exactly what the "…" trigger did once the picker became
    // global chrome. They read their `top` from `--floating-control-top`
    // (`theme.layout.floatingControlTop`), so telling them is a matter of
    // setting it on everything that follows the band: `<main>` is a sibling of
    // it, and a custom property inherits from there to the controls inside.
    //
    // A sibling selector rather than a class on a wrapper, because it cannot
    // fall out of step: the band styles itself and offsets the page in one
    // place, and when the band is not rendered — every non-admin — the
    // property is never set and the fallback position applies untouched.
    //
    // The controls sit one `space.xxl` below the band, mirroring the same
    // `space.xxl` the band holds between the switcher row and its rule: picker,
    // gap, rule, gap, control. (An earlier `space.lg` gap ON TOP of an
    // overstated band height put them visibly too low.)
    //
    // Then they RIDE IT UP. The band scrolls away with the page while the
    // controls, being fixed, do not, and an offset for chrome that is no
    // longer on screen just leaves them stranded low. Subtracting how far the
    // page has scrolled (`useScrollOffsetProperty`, which is what puts that
    // property on the document element) moves them with the band, and the
    // `max()` floor is the position they hold when there is no band at all —
    // so they slide up, stop there, and from then on behave exactly as they do
    // for a reader.
    '& ~ *': {
      '--floating-control-top': `max(${theme.layout.floatingControlTopBase}, calc(${bandHeight(theme)} + ${theme.space.xxl} - var(${scrollOffsetProperty}, 0px)))`,
    },
  },
  // The inner box mirrors `component/page`'s `<main>` — same max width, same
  // horizontal gutter — so the picker sits on the page's own column even though
  // the rule around it runs edge to edge.
  switcher: {
    maxWidth: 800,
    margin: '0 auto',
    padding: `0 ${theme.space.xxl}`,
  },
}));
