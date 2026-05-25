import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  const dropZoneBase = {
    borderRadius: theme.radius.md,
    padding: theme.space.xxxxxl,
    textAlign: 'center' as const,
    cursor: 'pointer',
    transition: `background 0.15s`, // drop-zone-specific quick transition; not on theme scale
  };

  return {
    dropZone: {
      ...dropZoneBase,
      background: theme.color.brand.light,
    },
    dropZoneOver: {
      ...dropZoneBase,
      background: theme.color.blue[100],
    },
    dropText: {
      color: theme.color.brand.default,
    },
    clickLabel: {
      textDecoration: 'underline',
      cursor: 'pointer',
    },
  };
});
