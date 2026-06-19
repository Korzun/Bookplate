import { useSeriesBookList } from '~/provider/book';

import { Cover } from '../cover';

import { useStyle } from './style';

interface CoverStackProps {
  seriesName: string;
  layerWidth: number;
  layerHeight: number;
}

export function CoverStack({ seriesName, layerWidth, layerHeight }: CoverStackProps) {
  const style = useStyle({ layerHeight, layerWidth });
  const [bookList] = useSeriesBookList(seriesName);

  return (
    <figure className={style.figure}>
      <div className={style.wrapper}>
        {([3, 2, 1] as const).map((seq) => {
          const book = bookList ? (bookList[3 - seq] ?? null) : null;
          return (
            <Cover
              key={book ? book.id : `ghost-${seq}`}
              bookId={book?.hasCover ? book.id : null}
              title={book?.title}
              sequence={seq}
              width={layerWidth}
              height={layerHeight}
              thumbnailWidth={layerWidth * 2}
            />
          );
        })}
      </div>
    </figure>
  );
}
