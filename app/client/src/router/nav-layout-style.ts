import { createUseStyles, type Theme } from '~/provider/theme';

// The gap between the status-bar inset and the picker. Larger than the `space.xxl`
// the band keeps between the picker and its rule, on purpose: in the installed app
// `TopFade` blurs across the inset and the picker is the first thing under it, so it
// sits a step further down than the symmetric rhythm would put it — the same
// `space.xxxxl` the page's back / actions controls keep from the inset
// (`theme.layout.floatingControlTopBase`). In a browser tab the inset is zero and
// the picker is simply this far from the top.
const bandTopGap = (theme: Theme) => theme.space.xxxxl;

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
    paddingTop: `calc(env(safe-area-inset-top) + ${bandTopGap(theme)})`,
    paddingBottom: theme.space.xxl,
    borderBottom: `1px solid ${theme.color.border.section}`,
    // What the page below needs to know about this band, told to everything
    // that follows it: `<main>` is a sibling, and a custom property inherits
    // from there into whatever inside it reads one. A sibling selector rather
    // than a class on a wrapper, because it cannot fall out of step: the band
    // styles itself and informs the page in one place, and when the band is
    // not rendered — every non-admin — nothing is set and each `var()`
    // fallback stands.
    '& ~ *': {
      // The page starts flush under the rule: the inset is spent above the
      // picker, so `<main>` must not add it a second time
      // (`component/page/style`).
      '--page-top-inset': '0px',
      // The page's back / actions row rests `space.xxl` below the rule,
      // mirroring the `space.xxl` the band holds between the picker and its
      // rule: picker, gap, rule, gap, control. The row is sticky, so from there
      // it rides up with the band and pins at its own resting position
      // (`component/page/style`).
      '--floating-controls-gap': theme.space.xxl,
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
