import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Mirrors `component/page`'s `<main>` box — same max width, same horizontal
  // gutter — so the global picker sits on the page's own column rather than
  // spanning the viewport. The vertical margin is deliberately smaller than
  // the page's: this is chrome above the nav, not the start of the content.
  switcher: {
    maxWidth: 800,
    margin: `${theme.space.xxl} auto 0`,
    padding: `0 ${theme.space.xxl}`,
    '&:empty': { display: 'none' },
  },
}));
