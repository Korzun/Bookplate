import { createUseStyles, type Theme } from '~/provider/theme';

type SequenceStyle = {
  left: number;
  top: number;
  rotate: string;
  zIndex: number;
  ghostOpacity: number;
};

const sequenceStyle: Record<1 | 2 | 3, SequenceStyle> = {
  1: { left: 6, top: 0, rotate: '0deg', zIndex: 1, ghostOpacity: 0.2 },
  2: { left: 3, top: 0, rotate: '0deg', zIndex: 2, ghostOpacity: 0.4 },
  3: { left: 0, top: 0, rotate: '0deg', zIndex: 3, ghostOpacity: 0.6 },
};

export type StyleProps = {
  sequence: 1 | 2 | 3;
  height: number;
  width: number;
  isGhost: boolean;
};

export const useStyle = createUseStyles((theme: Theme) => ({
  layer: {
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.bg.card,
    position: 'absolute',
    left: ({ sequence }: StyleProps) => sequenceStyle[sequence].left,
    width: ({ width }: StyleProps) => width,
    height: ({ height }: StyleProps) => height,
    transformOrigin: 'bottom left',
    transform: ({ sequence }: StyleProps) => `rotate(${sequenceStyle[sequence].rotate})`,
    zIndex: ({ sequence }: StyleProps) => sequenceStyle[sequence].zIndex,
    opacity: ({ sequence, isGhost }: StyleProps) =>
      isGhost ? sequenceStyle[sequence].ghostOpacity : 1,
    boxShadow: ({ sequence, isGhost }: StyleProps) =>
      isGhost ? `0px 0px 2px rgba(0,0,0,${sequenceStyle[sequence].ghostOpacity - 0.15})` : 'none',
  },
  coverImg: {
    objectFit: 'cover',
    display: 'block',
  },
  ghost: {
    background: theme.color.bg.placeholder,
  },
}));
