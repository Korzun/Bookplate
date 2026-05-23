import { createUseStyles } from '~/provider/theme';

export type StyleProps = {
  containerWidth: number;
  containerHeight: number;
};

export const useStyle = createUseStyles({
  figure: {
    flexShrink: 0,
    margin: 0,
    padding: 0,
    marginBottom: '-12px',
    marginRight: '-15px',
    position: 'relative',
    overflow: 'hidden',
    width: ({ containerWidth }: StyleProps) => containerWidth,
    height: ({ containerHeight }: StyleProps) => containerHeight,
  },
  wrapper: {
    position: 'absolute',
    inset: 0,
  },
});
