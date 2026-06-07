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
  titleWrapper: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.space.xl,
  },
  chevron: {
    position: 'relative',
    top: '4.5px', // sub-pixel optical centering
    left: '1.5px',
    display: 'block',
    height: '20px',
    width: '20px',
    margin: '-6px',
    transition: `transform ${theme.transition.medium}`,
  },
  chevronCollapsed: {
    transform: 'rotate(0deg)',
  },
  chevronExpanded: {
    transform: 'rotate(90deg)',
  },
  clickable: { cursor: 'pointer' },
  collapsed: {},
  danger: {},
  small: {},
  large: {},
}));
