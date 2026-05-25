import { createUseStyles, type Theme } from '~/provider/theme';

export const useStyle = createUseStyles((theme: Theme) => ({
  root: {
    position: 'relative',
    height: '40px',
    cursor: 'pointer',
    userSelect: 'none',
    touchAction: 'none',
  },
  track: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: '4px',
    background: theme.color.border.light,
    borderRadius: '2px', // slider-tick geometry — stays literal
    transform: 'translateY(-50%)',
  },
  fill: {
    position: 'absolute',
    top: '50%',
    left: 0,
    height: '4px',
    background: theme.color.brand.default,
    borderRadius: '2px',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
  tick: {
    position: 'absolute',
    top: '50%',
    width: '2px',
    height: '14px',
    background: theme.color.border.light,
    transform: 'translate(-50%, -50%)',
    borderRadius: '1px',
    pointerEvents: 'none',
  },
  tickActive: {
    background: theme.color.brand.default,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: '18px',
    height: '18px',
    background: theme.color.brand.default,
    borderRadius: theme.radius.circle,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,.2)', // slider-thumb-specific shadow
  },
  thumbDisabled: {
    background: theme.color.text.faint,
    cursor: 'not-allowed',
  },
  labels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: theme.fontSize.xs,
    color: theme.color.text.faint,
    marginTop: theme.space.xs,
  },
}));
