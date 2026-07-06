import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  content: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
    gap: theme.space.xs,
  },
  filename: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.primary,
    fontWeight: theme.fontWeight.medium,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
    flexGrow: 1,
  },
  validationLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.space.sm,
  },
  separator: {
    color: theme.color.text.faint,
    userSelect: 'none',
  },
  detailsLink: {
    // Double the class specificity so this wins over Button's base `.root`
    // font-size (0.80rem) without !important, matching the xs text alongside it.
    '&&': {
      fontSize: 'inherit',
    },
  },

  icon: {
    lineHeight: 0, // icon-specific alignment override
    '& svg': {
      height: '15px',
      width: '15px',
    },
    '&$queued': {
      color: theme.color.text.faint,
    },
    '&$uploading': {
      color: theme.color.brand.default,
      ...theme.recipe.spinner,
      // recipe.spinner already provides animation + 1em height/width; the inner svg sizing above overrides
    },
    '&$done': {
      color: theme.color.success,
    },
    '&$error': {
      color: theme.color.danger.default,
    },
  },
  labelContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  leftLabel: {
    fontSize: theme.fontSize.sm,
    flexGrow: 1,
    textTransform: 'capitalize',
    '&$queued': {
      color: theme.color.text.faint,
    },
    '&$uploading': {
      color: theme.color.brand.default,
      '& svg': {
        animation: 'theme-rotation 1s infinite linear',
      },
    },
    '&$done': {
      color: theme.color.success,
    },
    '&$error': {
      color: theme.color.danger.default,
    },
  },
  rightLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    whiteSpace: 'nowrap',
    textAlign: 'right',
    '&$error': {
      color: theme.color.danger.default,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '12rem',
    },
  },
  barTrack: {
    flex: 1,
    height: theme.space.md,
    background: theme.color.border.light,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: '2px', // bar-fill specific tiny radius
    '&$queued': {
      width: '0%',
    },
    '&$uploading': {
      background: theme.color.brand.default,
      transition: 'width 0.1s ease',
    },
    '&$done': {
      background: theme.color.success,
    },
    '&$error': {
      background: theme.color.danger.default,
    },
  },
  queued: {},
  uploading: {},
  done: {},
  error: {},
}));
