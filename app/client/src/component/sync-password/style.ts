import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.md,
    marginBottom: theme.space.md,
  },
  password: {
    fontFamily: 'monospace',
    fontSize: '1.1em',
    flex: 1,
  },
}));
