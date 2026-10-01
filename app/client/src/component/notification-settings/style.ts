import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  hint: {
    margin: 0,
    marginBottom: theme.space.md,
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
  },
  /**
   * The (event x channel) matrix rendered AS a matrix: one row per event, one
   * toggle column per configured channel. `--channel-count` is set inline
   * because only the component knows how many channels this install has —
   * a mail-less one gets a single `Push` column.
   *
   * The event label column is `minmax(0, 1fr)` so it, and never the toggle
   * columns, absorbs the squeeze at narrow widths: the labels are short
   * ("Request fulfilled") and may wrap, but a toggle must never be clipped or
   * shrunk below its tap target.
   */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) repeat(var(--channel-count, 1), auto)',
    alignItems: 'center',
    columnGap: theme.space.lg,
    rowGap: theme.space.sm,
  },
  columnHeader: {
    justifySelf: 'center',
    color: theme.color.text.description,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowHeader: {
    color: theme.color.text.primary,
  },
  cell: {
    justifySelf: 'center',
  },
  deviceList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.space.sm,
  },
  device: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  deviceName: {
    fontWeight: theme.fontWeight.medium,
  },
  thisDevice: {
    marginLeft: theme.space.sm,
    padding: `${theme.space.xxxs} ${theme.space.sm}`,
    borderRadius: theme.radius.md,
    fontSize: theme.fontSize.xs,
    color: theme.color.text.description,
    background: theme.color.bg.cardHeader,
  },
  deviceMeta: {
    display: 'block',
    marginTop: theme.space.xxxs,
    color: theme.color.text.muted,
    fontSize: theme.fontSize.sm,
  },
}));
