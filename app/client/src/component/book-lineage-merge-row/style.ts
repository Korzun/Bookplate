import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  entry: {
    display: 'flex',
    gap: 0,
    marginTop: theme.space.sm,
  },
  connector: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    flexShrink: 0,
    alignSelf: 'stretch',
    position: 'relative',
    top: '3px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: theme.color.gray[500],
    borderRadius: theme.radius.circle,
    flexShrink: 0,
  },
  line: {
    width: `calc(${theme.space.md} + 6px)`,
    borderTop: `2px solid ${theme.color.border.light}`,
    borderRight: `2px solid ${theme.color.border.light}`,
    borderTopRightRadius: theme.radius.md,
    transformOrigin: 'top left',
    transform: 'rotate(180deg)',
    flex: 1,
    position: 'absolute',
    top: 6,
    minHeight: theme.space.xxl,
  },
  entryContent: {
    paddingLeft: theme.space.md,
    flex: 1,
    minWidth: 0,
  },
  entryId: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    color: theme.color.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    wordBreak: 'break-all',
  },
  timestamp: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xxs,
  },
  button: {
    marginTop: '-1px',
    marginBottom: '-1px',
  },
}));
