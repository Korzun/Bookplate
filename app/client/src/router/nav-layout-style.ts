import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // The band: full-bleed, carrying the rule that separates the global picker
  // from the rest of the page. `border.section` is the token the page-level
  // section dividers already use (`page/book`, `page/series`), so this line
  // matches them in both themes rather than inventing a colour.
  switcherBand: {
    paddingTop: theme.space.xxl,
    paddingBottom: theme.space.xxl,
    borderBottom: `1px solid ${theme.color.border.section}`,
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
