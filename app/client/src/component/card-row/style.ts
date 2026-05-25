import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.card.shell,
    backgroundColor: theme.color.bg.card,
    padding: '6px', // row-specific compact padding
    borderRadius: '12px', // row-specific 10px radius (not on theme scale)
  },
  clickable: {
    cursor: 'pointer',
  },
}));
