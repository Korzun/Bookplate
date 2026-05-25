import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  title: {
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
    transition: `transform ${theme.transition.slow}`,
  },
  collapsed: {
    transform: 'rotate(0deg)',
  },
  expanded: {
    transform: 'rotate(90deg)',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.1rem', // single-component tight gap
  },
  username: {
    color: theme.color.danger.default,
    fontWeight: theme.fontWeight.extrabold,
  },
  undone: {
    fontWeight: theme.fontWeight.extrabold,
  },
}));
