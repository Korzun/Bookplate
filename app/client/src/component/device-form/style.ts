import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.md,
  },
  // While editing an existing device, tint the card border with the control
  // hover color so it reads as an active, actionable state. `&&` doubles the
  // selector specificity to win over the card shell's `borderColor`.
  editing: {
    '&&': {
      borderColor: theme.color.border.hover,
    },
  },
}));
