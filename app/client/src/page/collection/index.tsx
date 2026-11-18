import { useQuery } from '@apollo/client/react';
import { useParams } from 'react-router';

import { BookRowFromSeriesBook, Card, Page } from '~/component';
import { graphql } from '~/gql';
import { useCurrentLibraryId } from '~/provider/library-target';
import { path } from '~/router';

import { useStyle } from './style';

/**
 * Modelled on `SeriesDetailDocument` (`page/series`): rooted at
 * `node(id: $libraryId)` for the same admin/non-admin reason, with a LITERAL
 * `books(first: 100)` (the server's max page; a larger collection truncates,
 * the same carried limitation as a series). Each edge's node is a
 * `BookCollectionMembership`, so the position sits beside the book and the
 * book reuses `SeriesBookRowFragment` — the rows look exactly like a series'.
 * Edges arrive in API order (position ascending, unpositioned last, then
 * title); the page does not re-sort.
 */
export const CollectionDetailDocument = graphql(`
  query CollectionDetail($libraryId: ID!, $name: String!) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        collectionByName(name: $name) {
          id
          name
          bookCount
          books(first: 100) {
            edges {
              node {
                position
                book {
                  id
                  ...SeriesBookRowFragment
                }
              }
            }
          }
        }
      }
    }
  }
`);

export const CollectionPage = () => {
  const { name } = useParams<{ name: string }>();
  const style = useStyle();

  // `loading` folds in `useCurrentLibraryId`'s own `loading` for the same
  // reason `page/series` does: a skipped `useQuery` reports `loading: false`,
  // which would flash "not found" during the bootstrap window.
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();
  const {
    data,
    loading: queryLoading,
    error,
  } = useQuery(CollectionDetailDocument, {
    variables: { libraryId: libraryId ?? '', name: name! },
    skip: libraryId === undefined,
  });
  const loading = queryLoading || libraryIdLoading;

  const node = data?.node;
  const collection =
    node?.__typename === 'Library' ? (node.collectionByName ?? undefined) : undefined;

  if (loading) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.loading}>Loading…</p>
        </Card>
      </Page>
    );
  }

  // Transport failures are checked before not-found, as on the series page.
  if (error !== undefined) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.notFound}>Failed to load collection.</p>
        </Card>
      </Page>
    );
  }

  if (collection === undefined) {
    return (
      <Page back={path.library()}>
        <Card>
          <p className={style.notFound}>Collection not found.</p>
        </Card>
      </Page>
    );
  }

  return (
    <Page back={path.library()}>
      <Card>
        <h1 className={style.title}>{collection.name}</h1>
        <div className={style.count}>
          {collection.bookCount} {collection.bookCount === 1 ? 'book' : 'books'}
        </div>
      </Card>
      <Card title="Books">
        <div className={style.bookList}>
          {collection.books.edges.map((edge, index) => (
            <BookRowFromSeriesBook
              // The masked `book` ref has no readable `id`; the membership's
              // index within API order is stable for a given response.
              key={index}
              asCard={false}
              showAuthor={false}
              book={edge.node.book}
              position={edge.node.position}
            />
          ))}
        </div>
      </Card>
    </Page>
  );
};
