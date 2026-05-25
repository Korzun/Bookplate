import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  toast: {
    position: 'fixed' as const,
    bottom: theme.space.xxxxl,
    right: theme.space.xxxxl,
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    padding: `${theme.space.lg} ${theme.space.xxl}`,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.medium,
    color: theme.color.text.primary,
    background: theme.color.bg.card,
    boxShadow: theme.shadow.hoverLift,
    zIndex: theme.zIndex.toast,
    animation: `theme-slide-in ${theme.transition.slide}`,
  },
  iconSuccess: { display: 'flex', color: theme.color.success },
  iconError: { display: 'flex', color: theme.color.danger.default },
}));
