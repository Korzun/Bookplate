import { createUseStyles, type Theme } from '~/provider/theme';
import { applyTransparency } from '~/utils';

export const useStyle = createUseStyles((theme: Theme) => ({
  list: {
    listStyle: 'none',
    margin: 0,
  },
  entry: {
    display: 'flex',
    gap: 0,
    '&:last-child $entryContent': {
      paddingBottom: 0,
    },
  },
  connector: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '20px',
    flexShrink: 0,
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: theme.radius.circle,
    backgroundColor: theme.color.blue[400],
    marginTop: '4px',
    flexShrink: 0,
  },
  dotCurrent: {
    backgroundColor: theme.color.brand.default,
  },
  dotInitial: {
    backgroundColor: theme.color.success,
  },
  line: {
    width: '2px',
    backgroundColor: theme.color.border.light,
    flex: 1,
    marginTop: theme.space.xs,
    minHeight: theme.space.xxl,
  },
  entryContent: {
    paddingBottom: theme.space.xxxl,
    paddingLeft: theme.space.md,
    flex: 1,
    minWidth: 0,
  },
  entryId: {
    fontFamily: "'Cascadia Code', 'Fira Code', monospace",
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    wordBreak: 'break-all',
  },
  badge: {
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: `${theme.space.xxxs} ${theme.space.xs}`,
    borderRadius: theme.radius.sm,
    fontSize: theme.fontSize.xxs,
  },
  badgeCurrent: {
    backgroundColor: theme.color.brand.light,
    color: theme.color.brand.default,
    border: `1px solid ${theme.color.brand.outline}`,
  },
  badgeInitial: {
    backgroundColor: applyTransparency(theme.color.success, 0.1),
    color: theme.color.success,
    border: `1px solid ${applyTransparency(theme.color.success, 0.4)}`,
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xxs,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.color.danger.default,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
  loading: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    padding: `${theme.space.md} ${theme.space.xl}`,
  },
}));
