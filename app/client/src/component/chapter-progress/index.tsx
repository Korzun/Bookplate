import { ListCheckIcon } from '~/icon';

import { useStyle } from './style';

type ChapterProgressProps = {
  current: number;
  total: number;
  name?: string;
};

export const ChapterProgress = ({ current, total, name }: ChapterProgressProps) => {
  const style = useStyle();

  return (
    <div className={style.root}>
      <ListCheckIcon width={12} height={12} strokeWidth={2.5} />
      <span className={style.label}>
        {name ? `Ch ${current}: ${name} / ${total}` : `Ch ${current} / ${total}`}
      </span>
    </div>
  );
};
