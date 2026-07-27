import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  metadata: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  appliedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.space.sm,
    fontSize: theme.fontSize.sm,
    // The fix text stays in the normal body colour; only the check icon is green
    // — the icon + colour already convey success without recolouring the text.
    color: theme.color.text.primary,
    '& svg': {
      // Match the upload "Done" status checkmark size.
      height: '15px',
      width: '15px',
      color: theme.color.success,
    },
  },
  // Suggestions are set apart from one another so each reads as a distinct block.
  proposalList: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xl,
  },
  proposalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.space.md,
    fontSize: theme.fontSize.sm,
  },
  // Column: the change on the first line, its reason tucked directly beneath it
  // (tight gap) so the reason reads as part of this suggestion, not a separate one.
  proposalText: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.xxs,
    minWidth: 0,
  },
  proposalMain: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: theme.space.sm,
  },
  fieldName: {
    fontWeight: theme.fontWeight.semibold,
  },
  fromValue: {
    textDecoration: 'line-through',
    color: theme.color.text.faint,
  },
  flagText: {
    fontStyle: 'italic',
    color: theme.color.danger.default,
  },
  reason: {
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
  },
  proposalActions: {
    display: 'flex',
    gap: theme.space.md,
    flexShrink: 0,
  },
  editLink: {
    fontSize: theme.fontSize.sm,
    color: theme.color.brand.default,
  },
  chipLine: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  chipGroup: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.space.xs,
  },
}));
