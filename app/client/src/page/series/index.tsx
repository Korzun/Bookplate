import { useParams } from 'react-router-dom';

import {
  Card,
  CoverStack,
  BookRow,
  Page,
  ProgressIndicator,
  MetadataList,
  Metadata,
} from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useSeriesBookList } from '~/provider/book';
import { useMySeriesProgress } from '~/provider/progress';

import { useStyle } from './style';

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const style = useStyle();

  const [isAdmin] = useIsAdmin();
  const [seriesBookList, loading, error] = useSeriesBookList(name!);
  const [seriesProgressPercent] = useMySeriesProgress(name!);

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  if (error || seriesBookList.length === 0) {
    return (
      <Page>
        <Card>
          <p className={style.notFound}>Series not found.</p>
        </Card>
      </Page>
    );
  }

  // Metadata
  const metadata: Metadata[] = [];
  if (!isAdmin) {
    metadata.push({
      title: 'progress',
      value: (
        <ProgressIndicator value={seriesProgressPercent ? seriesProgressPercent : 0} size={12} />
      ),
    });
  }
  metadata.push({
    title: 'books',
    value: seriesBookList?.length,
  });

  const totalPages = seriesBookList.reduce((sum, book) => sum + book.pageCount, 0);
  if (totalPages > 0) {
    metadata.push({ title: 'pages', value: totalPages });
  }

  metadata.push({
    title: 'publisher',
    value: Array.from(new Set(seriesBookList.map((book) => book.publisher).filter(Boolean))).join(
      ', '
    ),
  });

  const author = seriesBookList[0].author;

  return (
    <Page>
      <Card>
        <div className={style.cardContainer}>
          <div className={style.hero}>
            <CoverStack
              seriesName={name!}
              containerWidth={100}
              containerHeight={130}
              layerWidth={80}
              layerHeight={118}
            />
            <div>
              <h1 className={style.title}>{name}</h1>
              <div className={style.author}>{author}</div>
            </div>
          </div>
          <div className={style.metadata}>
            <MetadataList metadata={metadata} />
          </div>
        </div>
      </Card>
      <Card title="Books">
        <div className={style.bookList}>
          {seriesBookList.map((book) => (
            <BookRow key={book.id} asCard={false} bookId={book.id} showAuthor={false} />
          ))}
        </div>
      </Card>
    </Page>
  );
};
