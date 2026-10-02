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
      top: 'auto',
      right: theme.space.xxl,
      left: theme.space.xxl,
      // Rest just above the floating bottom nav (plus the home-indicator inset).
      // Sit one layer below the nav so toasts slide up from behind it, not over it.
      bottom: `calc(${theme.layout.navHeightMobile} + ${theme.space.md} + env(safe-area-inset-bottom))`,
      zIndex: theme.zIndex.sticky - 1,
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
      animation: `theme-slide-in-up ${theme.transition.slide}`,
    },
  },
  toastExiting: {
    animation: `theme-slide-out ${theme.transition.slide}`,
    animationFillMode: 'forwards' as const,
    [theme.breakpoint.mobile]: {
      animation: `theme-slide-out-down ${theme.transition.slide}`,
      animationFillMode: 'forwards' as const,
    },
  },
  iconSuccess: { display: 'flex', color: theme.color.success },
  iconError: { display: 'flex', color: theme.color.danger.default },
  iconInfo: { display: 'flex', color: theme.color.brand.default },
}));
