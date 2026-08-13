import { useNavigate, useParams } from 'react-router';

import {
  Card,
  CoverStack,
  BookRowFromSeriesBook,
  Page,
  ProgressIndicator,
  MetadataList,
  Metadata,
  Tag,
} from '~/component';
import { makeFragmentData } from '~/gql';
import { SeriesBookRowFragment } from '~/graphql/series';
import { coverUrl } from '~/lib/cover-url';
import { useIsAdmin } from '~/provider/auth';
import { useSeries, useSeriesBookList } from '~/provider/book';
import { useWithTargetUser } from '~/provider/library-target';
import { useMySeriesProgress } from '~/provider/progress';
import { path } from '~/router';
import { formatSize } from '~/utils';

import { useStyle } from './style';

const COVER_STACK_LAYER_WIDTH = 80;

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const style = useStyle();
  const withTargetUser = useWithTargetUser();

  const [isAdmin] = useIsAdmin();
  const [seriesBookList, booksLoading, booksError] = useSeriesBookList(name!);
  const [series, seriesLoading, seriesError] = useSeries(name!);
  const [seriesProgressPercent] = useMySeriesProgress(name!);

  const loading = booksLoading || seriesLoading;
  const error = booksError || seriesError;

  if (loading) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  if (error || !seriesBookList || seriesBookList.length === 0 || !series) {
    return (
      <Page back={path.library()}>
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
    <Page back={path.library()}>
      <Card>
        <div className={style.cardContainer}>
          <div className={style.hero}>
            <CoverStack
              books={seriesBookList.slice(0, 3).map((book) => ({
                id: book.id,
                title: book.title,
                src: book.hasCover
                  ? withTargetUser(
                      coverUrl(book.id, {
                        width: COVER_STACK_LAYER_WIDTH * 2,
                        version: book.mtime,
                      })
                    )
                  : null,
              }))}
              layerWidth={COVER_STACK_LAYER_WIDTH}
              layerHeight={120}
            />
            <div>
              <h1 className={style.title}>{name}</h1>
              <div
                className={style.author}
                onClick={() => navigate(path.library({ author: series.author }))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(path.library({ author: series.author }));
                  }
                }}
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
            <BookRowFromSeriesBook
              key={book.id}
              asCard={false}
              showAuthor={false}
              // TEMPORARY shim, Task 6 only: this page still reads
              // `useSeriesBookList`, a REST hook (`Book` has no `progress`
              // field), not `useSeriesDetail`'s GraphQL `SeriesBookRowFragment`
              // refs. `makeFragmentData` fabricates a fragment-shaped ref by
              // hand so `BookRowFromSeriesBook` (which now only accepts
              // fragment data) can render `Book`s a plain REST fetch already
              // holds — at the cost of losing per-row progress here, since
              // REST has no per-book equivalent to wire in. Task 7 rewires
              // this page onto `useSeriesDetail` and deletes this shim, which
              // restores real per-row progress via the fragment's own
              // `progress { percentage }` field.
              book={makeFragmentData(
                {
                  __typename: 'Book',
                  id: book.id,
                  title: book.title,
                  seriesIndex: book.seriesIndex,
                  hasCover: book.hasCover,
                  thumbnailUrl: book.hasCover
                    ? withTargetUser(coverUrl(book.id, { width: 88, version: book.mtime }))
                    : '',
                  progress: null,
                },
                SeriesBookRowFragment
              )}
            />
          ))}
        </div>
      </Card>
    </Page>
  );
};
