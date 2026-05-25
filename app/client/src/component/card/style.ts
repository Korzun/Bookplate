import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.card.shell,
    '&$small': { borderRadius: '9px' },
  },
  header: {
    ...theme.recipe.card.header,
    '&$danger': { color: theme.color.danger.default },
    '&$collapsed': { borderBottomStyle: 'none' },
  },
  title: {
    fontWeight: theme.fontWeight.semibold,
    fontSize: theme.fontSize.md,
    color: theme.color.text.muted,
  },
  subTitle: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginLeft: theme.space.xs,
  },
  spacer: { flexGrow: 1 },
  content: {
    '&$small': {
      padding: '1px',
    },
    '&$large': { padding: theme.space.xl },
  },
  clickable: { cursor: 'pointer' },
  collapsed: {},
  danger: {},
  small: {},
  large: {},
}));
