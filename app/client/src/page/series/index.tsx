import { useParams } from 'react-router-dom';

import {
  Card,
  CoverStack,
  BookRow,
  Page,
  ProgressIndicator,
  MetadataList,
  Metadata,
  Tag,
} from '~/component';
import { useIsAdmin } from '~/provider/auth';
import { useSeries, useSeriesBookList } from '~/provider/book';
import { useMySeriesProgress } from '~/provider/progress';

import { useStyle } from './style';

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const style = useStyle();

  const [isAdmin] = useIsAdmin();
  const [seriesBookList, booksLoading, booksError] = useSeriesBookList(name!);
  const [series, seriesLoading, seriesError] = useSeries(name!);
  const [seriesProgressPercent] = useMySeriesProgress(name!);

  const loading = booksLoading || seriesLoading;
  const error = booksError || seriesError;

  if (loading) {
    return (
      <Page>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  if (error || !seriesBookList || seriesBookList.length === 0 || !series) {
    return (
      <Page>
        <Card>
          <p className={style.notFound}>Series not found.</p>
        </Card>
      </Page>
    );
  }

  const metadata: Metadata[] = [];
  if (!isAdmin) {
    metadata.push({
      title: 'progress',
      value: (
        <ProgressIndicator value={seriesProgressPercent ? seriesProgressPercent : 0} size={12} />
      ),
    });
  }
  metadata.push({ title: 'books', value: series.bookCount });
  if (series.totalPages > 0) {
    metadata.push({ title: 'pages', value: series.totalPages });
  }
  if (series.publisher) {
    metadata.push({ title: 'publisher', value: series.publisher });
  }

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
              <div className={style.author}>{series.author}</div>
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
      {series.subjects.length > 0 && (
        <Card title="Subjects">
          <div className={style.subjects}>
            {series.subjects.map((subject, index) => (
              <Tag key={subject + index}>{subject}</Tag>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
};
