import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  entry: {
    display: 'flex',
    gap: 0,
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
  dotCurrent: {
    backgroundColor: theme.color.brand.default,
    borderColor: theme.color.brand.default,
  },
  line: {
    width: '2px',
    backgroundColor: theme.color.border.light,
    flex: 1,
    marginLeft: '4px',
    minHeight: theme.space.xxl,
    ['&$isInitial']: {
      marginBottom: `calc(${theme.fontSize.sm} + ${theme.fontSize.xs} + ${theme.fontSize.xxs})`,
    },
  },
  entryContent: {
    paddingBottom: theme.space.md,
    paddingLeft: theme.space.md,
    flex: 1,
    minWidth: 0,
    ['&$isInitial']: {
      paddingBottom: 0,
    },
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
  isInitial: {},
}));
