import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
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
  // The pending-request-count badge next to the username in the collapsed
  // card's title — `Card`'s own `title` div is not a flex container, so this
  // margin is what separates the badge from the username text.
  badge: {
    marginLeft: theme.space.sm,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    margin: `${theme.space.sm} 0 0`,
  },
}));
