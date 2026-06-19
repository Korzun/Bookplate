import { useNavigate, useParams } from 'react-router-dom';

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
import { path } from '~/router';
import { formatSize } from '~/utils';

import { useStyle } from './style';

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
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
  if (series.totalPages > 0) {
    metadata.push({ title: 'pages', value: series.totalPages });
  }
  if (series.publisher) {
    metadata.push({ title: 'publisher', value: series.publisher });
  }
  if (series.totalSize > 0) {
    metadata.push({ title: 'size', value: formatSize(series.totalSize) });
  }

  return (
    <Page>
      <Card>
        <div className={style.cardContainer}>
          <div className={style.hero}>
            <CoverStack seriesName={name!} layerWidth={80} layerHeight={120} />
            <div>
              <h1 className={style.title}>{name}</h1>
              <div
                className={style.author}
                onClick={() => navigate(path.library({ author: series.author }))}
              >
                {series.author}
              </div>
            </div>
          </div>
          <div className={style.metadata}>
            <MetadataList metadata={metadata} />
          </div>
        </div>
      </Card>
      {series.subjects.length > 0 && (
        <Card title="Subjects">
          <div className={style.subjects}>
            {series.subjects.map((subject, index) => (
              <Tag key={subject + index} onClick={() => navigate(path.library({ subject }))}>
                {subject}
              </Tag>
            ))}
          </div>
        </Card>
      )}
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
