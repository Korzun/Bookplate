import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  hint: {
    margin: 0,
    marginBottom: theme.space.md,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  deviceRow: {
    marginBottom: theme.space.md,
    paddingBottom: theme.space.md,
    borderBottom: `1px solid ${theme.color.border.default}`,
  },
  deviceList: {
    listStyle: 'none',
    margin: 0,
    marginTop: theme.space.md,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
  device: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
    padding: `${theme.space.sm} 0`,
    borderTop: `1px solid ${theme.color.border.default}`,
  },
  deviceName: {
    fontWeight: theme.fontWeight.medium,
  },
  thisDevice: {
    marginLeft: theme.space.sm,
    padding: `${theme.space.xxxs} ${theme.space.sm}`,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.xs,
    color: theme.color.text.description,
    background: theme.color.bg.cardHeader,
  },
  deviceMeta: {
    display: 'block',
    marginTop: theme.space.xxxs,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
}));
