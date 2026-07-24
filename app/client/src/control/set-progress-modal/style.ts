import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    ...theme.recipe.modal.dialog,
  },
  dialog: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.color.bg.card,
  },
  header: {
    ...theme.recipe.modal.header,
  },
  chapterDisplay: {
    textAlign: 'center',
    padding: `${theme.space.md} ${theme.space.xxl}`,
  },
  chapterNumber: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.primary,
  },
  chapterNumberMuted: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.color.text.faint,
  },
  chapterName: {
    fontSize: theme.fontSize.sm,
    fontStyle: 'italic',
    color: theme.color.text.muted,
    marginTop: theme.space.xxs,
    minHeight: '1.25em',
  },
  chapterSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.color.text.muted,
    marginTop: theme.space.xxs,
  },
  sliderSection: {
    padding: `${theme.space.xl} ${theme.space.xxl} ${theme.space.xxxxl}`,
  },
  error: {
    color: theme.color.danger.default,
    fontSize: theme.fontSize.sm,
    padding: `0 ${theme.space.xxl} ${theme.space.xl}`,
  },
  footer: {
    ...theme.recipe.modal.footer,
  },
}));
