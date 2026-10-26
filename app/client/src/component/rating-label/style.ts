import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  glyph: {
    verticalAlign: '-2px',
    marginRight: theme.space.xxs,
  },
}));
