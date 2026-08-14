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
import { useFragment } from '~/gql';
import { SeriesBookRowFragment } from '~/graphql/series';
import { useIsAdmin } from '~/provider/auth';
import { useSeriesDetail } from '~/provider/library';
import { path } from '~/router';
import { formatSize } from '~/utils';

import { useStyle } from './style';

const COVER_STACK_LAYER_WIDTH = 80;

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const style = useStyle();

  const [isAdmin] = useIsAdmin();
  const { series, loading, error } = useSeriesDetail(name!);

  // `useFragment`'s array overload (`gql/fragment-masking.ts`) unmasks the
  // whole list in ONE call — no per-item `useFragment` inside a `.map()`,
  // which would call a hook from a loop and trip `react-hooks/rules-of-hooks`
  // even though the generated `useFragment` is just an identity cast at
  // runtime. Called unconditionally, before either early return below, with
  // `series?.books` optional-chained to an empty array while still loading.
  //
  // Unmasked once for the WHOLE list, not just `CoverStack`'s first three:
  // `BookRowFromSeriesBook` still receives the original MASKED `book` ref
  // below (it does its own `useFragment` in its own render context, per its
  // doc comment) — this array exists only so the page itself can read real
  // `id`s for `CoverStack` and for React keys, neither of which is on the
  // masked ref's declared type.
  const unmaskedBooks = useFragment(SeriesBookRowFragment, series?.books ?? []);
  const coverBooks = unmaskedBooks.slice(0, 3);

  if (loading) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  // `error` is checked FIRST and returns its own message — a transport
  // failure also leaves `series` `undefined`, and ORing it into the
  // not-found branch (the old REST code's `booksError || !seriesBookList`)
  // is exactly the bug a prior review caught in this file: a network error
  // reading as "Series not found." rather than "the series really isn't
  // there." See `useSeriesDetail`'s own doc comment for why `series ===
  // undefined` alone means "not found" only when `error` is undefined.
  if (error !== undefined) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.notFound}>Failed to load series.</p>
        </Card>
      </Page>
    );
  }

  if (series === undefined) {
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
        <ProgressIndicator
          value={series.progressPercentage ? series.progressPercentage : 0}
          size={12}
        />
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
              books={coverBooks.map((book) => ({
                id: book.id,
                title: book.title,
                src: book.hasCover ? book.thumbnailUrl : null,
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
          {series.books.map((book, index) => (
            <BookRowFromSeriesBook
              // `unmaskedBooks[index].id` (not `index` itself, not a field
              // read off the masked `book`) — `unmaskedBooks` mirrors
              // `series.books`' order/length 1:1 (`useFragment`'s identity
              // cast preserves both), so this is real per-book identity.
              key={unmaskedBooks[index]?.id ?? index}
              asCard={false}
              showAuthor={false}
              book={book}
            />
          ))}
        </div>
      </Card>
    </Page>
  );
};
