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
  // The card's `title` now carries the username AND (when the user has one)
  // their address, so it needs to be a flex row itself — mirrors
  // `component/email-setting`'s own `pill`/`badgeConfirmed`/
  // `badgeUnconfirmed` naming and tokens for the address + confirmed state.
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    flexWrap: 'wrap',
  },
  addressPill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  address: {
    color: theme.color.text.faint,
    fontSize: theme.fontSize.sm,
  },
  badgeConfirmed: {
    color: theme.color.success,
    fontSize: theme.fontSize.sm,
  },
  badgeUnconfirmed: {
    color: theme.color.text.faint,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    margin: `${theme.space.sm} 0 0`,
  },
}));
