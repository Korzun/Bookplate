import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  message: {
    fontSize: theme.fontSize.md,
  },
  error: {
    color: theme.color.danger.default,
  },
  // The decline-reason prompt, deliberately identical to the one a single
  // row's own decline modal renders (`component/book-request-row/style.ts`) —
  // the same question, asked of one request or of all of them, should not look
  // like two different fields. Copied rather than shared: two short rules
  // against a component extracted to carry them, with this note as the link.
  reasonLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxxs,
    fontSize: theme.fontSize.md,
  },
  reasonInput: {
    ...theme.recipe.input,
    minHeight: '6rem',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
}));
