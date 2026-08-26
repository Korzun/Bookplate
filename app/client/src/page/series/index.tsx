import { useQuery } from '@apollo/client/react';
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
import { SeriesBookRowFragment } from '~/component/book-row/from-series-book';
import { graphql, useFragment } from '~/gql';
import { useIsAdmin } from '~/provider/auth';
import { useCurrentLibraryId } from '~/provider/library-target';
import { path } from '~/router';
import { formatSize } from '~/utils';

import { useStyle } from './style';

const COVER_STACK_LAYER_WIDTH = 80;

/**
 * Rooted at `node(id: $libraryId)` like every library-scoped screen (spec
 * §2): `Query.user(id:)` is admin-only and `viewer.library` is null for the
 * config-based admin, so `node(id:)` is the only single root serving both
 * roles — the same reason `LibraryEntriesDocument` (`page/library/index.tsx`)
 * roots there.
 *
 * `books(first: 100)` is a LITERAL page size, priced at 100 rather than the
 * `maxSize` a variable `$first` would price at — identical to
 * `SeriesRowFragment`'s `books(first: 3)` in `component/series-row/index.tsx`.
 * 100 matches `CONNECTION_LIMITS.seriesBooks.maxSize` and the `MAX_TAKE` the
 * REST hook this replaces used, so a >100-book series truncates exactly as
 * it did before; that is a carried limitation, not a new one.
 *
 * `progressPercentage` replaces `useMySeriesProgress`'s client-side tally —
 * the server field added in step 5 whose semantics were verified to match it
 * exactly (parent spec §15).
 *
 * Measured (`test:cost -w app/server`): breadth 33 (33.0%), complexity 1617
 * (4.9%) of budget — comfortably under the 70% gate on both axes, UNCHANGED
 * from before this task's colocation (Ruling E's "+1 breadth per fragment
 * spread site" applies only when a document moves from an INLINE selection
 * to a named-fragment spread; this document already spread
 * `...SeriesBookRowFragment` before this task — only the fragment's JS
 * *source file* moved, into `component/book-row/from-series-book.tsx`, not
 * its usage in the printed query the cost walker measures — see the task
 * report for the sha256 proof).
 */
export const SeriesDetailDocument = graphql(`
  query SeriesDetail($libraryId: ID!, $name: String!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        seriesByName(name: $name) {
          id
          name
          author
          publisher
          totalPages
          totalSize
          subjects
          progressPercentage
          books(first: 100) {
            edges {
              node {
                id
                ...SeriesBookRowFragment
              }
            }
          }
        }
      }
    }
  }
`);

export const SeriesPage = () => {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const style = useStyle();

  const [isAdmin] = useIsAdmin();

  // Same `node(id:)` rooting as `page/library`: `libraryId` comes from
  // `useCurrentLibraryId`, learned only once `ViewerBootstrapDocument`
  // resolves. `loading` below folds THIS hook's own `loading` in for the
  // same cold-load reason `page/library` does — a SKIPPED `useQuery` reports
  // `loading: false` on its own, which would flash a false "series not
  // found" for the whole `ViewerBootstrap` window without the fold-in.
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const {
    data,
    loading: queryLoading,
    error,
  } = useQuery(SeriesDetailDocument, {
    variables: { libraryId: libraryId ?? '', name: name! },
    skip: libraryId === undefined,
  });
  const loading = queryLoading || libraryIdLoading;
  const errorMessage = error?.message;

  const node = data?.node;
  // A series name the library does not have resolves `seriesByName` to
  // `null` — the server's own "not found" answer, not a failure. That
  // surfaces below as `series === undefined` with `errorMessage ===
  // undefined`, deliberately indistinguishable from "hasn't loaded yet" at
  // the type level; the branches below tell the two apart via `loading`,
  // the same way any not-found screen does.
  const series = node?.__typename === 'Library' ? (node.seriesByName ?? undefined) : undefined;

  // `useFragment`'s array overload (`gql/fragment-masking.ts`) unmasks the
  // whole list in ONE call — no per-item `useFragment` inside a `.map()`,
  // which would call a hook from a loop and trip `react-hooks/rules-of-hooks`
  // even though the generated `useFragment` is just an identity cast at
  // runtime. Called unconditionally, before either early return below, with
  // `series?.books.edges` reshaped (edge -> node) and optional-chained to an
  // empty array while still loading — the same reshape
  // `use-series-detail.ts` used to do centrally, now inline here since that
  // hook is gone.
  //
  // Unmasked once for the WHOLE list, not just `CoverStack`'s first three:
  // `BookRowFromSeriesBook` still receives the original MASKED `book` ref
  // below (it does its own `useFragment` in its own render context, per its
  // doc comment) — this array exists only so the page itself can read real
  // `id`s for `CoverStack` and for React keys, neither of which is on the
  // masked ref's declared type.
  const unmaskedBooks = useFragment(
    SeriesBookRowFragment,
    series?.books.edges.map((edge) => edge.node) ?? []
  );
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

  // `errorMessage` is checked FIRST and returns its own message — a
  // transport failure also leaves `series` `undefined`, and ORing it into
  // the not-found branch (the old REST code's `booksError ||
  // !seriesBookList`) is exactly the bug a prior review caught in this file:
  // a network error reading as "Series not found." rather than "the series
  // really isn't there." `series === undefined` alone means "not found" only
  // when `errorMessage` is undefined.
  if (errorMessage !== undefined) {
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
          ariaLabel={`Reading progress for ${series.name}`}
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
          {series.books.edges.map((edge, index) => (
            <BookRowFromSeriesBook
              // `unmaskedBooks[index].id` (not `index` itself, not a field
              // read off the masked `edge.node`) — `unmaskedBooks` mirrors
              // `series.books.edges`' order/length 1:1 (`useFragment`'s
              // identity cast preserves both), so this is real per-book
              // identity.
              key={unmaskedBooks[index]?.id ?? index}
              asCard={false}
              showAuthor={false}
              book={edge.node}
            />
          ))}
        </div>
      </Card>
    </Page>
  );
};
