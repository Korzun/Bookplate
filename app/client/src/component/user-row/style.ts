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
  // The address and its confirmation state, now a row INSIDE the card rather
  // than a pill crammed into the title beside the username, where at phone
  // width it collided with the actions. `badgeConfirmed`/`badgeUnconfirmed`
  // match `component/email-setting`'s own classes of the same name exactly
  // (`theme.color.success` / `theme.color.text.faint`, `fontSize.sm`). The
  // address text stays toned down — `text.faint` at `fontSize.sm` rather than
  // `text.primary` at `fontSize.md` — because here it is secondary to the
  // username above it, not the main content it is on `email-setting`'s card.
  addressRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
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
