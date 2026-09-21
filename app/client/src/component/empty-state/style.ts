import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  // Lifted verbatim from `page/add/style.ts`'s own empty state (itself a copy
  // of `page/library`'s), which is what makes this component worth having:
  // three surfaces now share one block instead of three copies of it. Those
  // two pages still hold their own copies — they render their states inline
  // and moving them is not this fix's business — so treat this as the version
  // to migrate TO, not a fourth variant.
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `4rem ${theme.space.xxl}`, // 4rem is empty-state vertical padding
    gap: theme.space.md,
  },
  title: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.color.text.muted,
    '&$danger': { color: theme.color.danger.default },
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.faint,
    textAlign: 'center',
  },
  danger: {},
}));
