import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => {
  const dropZoneBase = {
    borderRadius: theme.radius.md,
    border: `1.5px dashed ${theme.color.brand.outline}`,
    padding: theme.space.xxxxxl,
    textAlign: 'center' as const,
    transition: `background 0.15s`, // drop-zone-specific quick transition; not on theme scale
  };

  return {
    dropZone: {
      ...dropZoneBase,
      background: theme.color.brand.light,
    },
    dropZoneOver: {
      ...dropZoneBase,
      background: theme.color.bg.selected,
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
