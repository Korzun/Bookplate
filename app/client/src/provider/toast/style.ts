import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  container: {
    position: 'fixed' as const,
    bottom: theme.space.xxxxl,
    right: theme.space.xxxxl,
    zIndex: theme.zIndex.toast,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: theme.space.md,
    alignItems: 'flex-end',
    [theme.breakpoint.mobile]: {
      bottom: 'auto',
      right: theme.space.xxl,
      left: theme.space.xxl,
      top: `calc(${theme.space.xxxxl} + env(safe-area-inset-top))`,
      alignItems: 'stretch',
    },
  },
  toast: {
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
    animation: `theme-slide-in ${theme.transition.slide}`,
    [theme.breakpoint.mobile]: {
      animation: `theme-slide-in-down ${theme.transition.slide}`,
    },
  },
  toastExiting: {
    animation: `theme-slide-out ${theme.transition.slide}`,
    animationFillMode: 'forwards' as const,
    [theme.breakpoint.mobile]: {
      animation: `theme-slide-out-up ${theme.transition.slide}`,
      animationFillMode: 'forwards' as const,
    },
  },
  iconSuccess: { display: 'flex', color: theme.color.success },
  iconError: { display: 'flex', color: theme.color.danger.default },
}));
