import { useCallback } from 'react';
import { useNavigate } from 'react-router';

import { graphql, useFragment, type FragmentType } from '~/gql';
import { path } from '~/router';

import { Card } from '../card';
import { CoverStack } from '../cover-stack';
import { useStyle } from './style';

/**
 * Colocated: this component declares exactly the fields it renders, and
 * `page/library` composes it into `LibraryEntriesDocument` (spread by NAME
 * inside `... on Series { ...SeriesRowFragment }` — codegen resolves that
 * against this `graphql(...)` definition without a JS import between the
 * two files).
 *
 * `Series.progressPercentage` — not the bare `progress` this field's server
 * counterpart carried in an earlier revision. That name would have needed
 * an alias here anyway: this fragment is spread alongside `BookRowFragment`
 * inside the SAME selection set (`LibraryEntriesDocument`'s `node { ... on
 * Book {...} ... on Series {...} }`, where the entry is the union `Book |
 * Series`), and `Book.progress` is an OBJECT field (`Progress`) — a bare
 * `Series.progress: Float` would have collided on response shape
 * (GraphQL's `SameResponseShape` rule, spec §5.3.2, applies to any two
 * same-response-name fields in a merged selection set regardless of the two
 * fields' parent types being mutually exclusive union members; verified
 * directly against `graphql-js`'s own `validate()`). The rename sidesteps
 * that collision for free, so no alias is needed here.
 *
 * DOES select `Series.books` — `books(first: 3)`, a LITERAL page size,
 * priced at 3 (`literalIntArg`/`pageSizeMultiplier` in `cost-limit.ts`), not
 * the 100 a variable `$first` would price at. Nesting a ×3 connection
 * inside `LibraryEntriesDocument`'s ×100 `entries` connection is what feeds
 * `CoverStack` its three cover books directly from this document instead of
 * a separate, REST-list-backed fetch — see `page/library/index.tsx`'s
 * `LibraryEntriesDocument` doc comment for the composed document's full
 * cost accounting.
 */
export const SeriesRowFragment = graphql(`
  fragment SeriesRowFragment on Series {
    id
    name
    author
    bookCount
    progressPercentage
    books(first: 3) {
      edges {
        node {
          id
          title
          hasCover
          mtime
          thumbnailUrl(width: 88)
        }
      }
    }
  }
`);

type SeriesRowProps = {
  series: FragmentType<typeof SeriesRowFragment>;
};

/**
 * Renders from `SeriesRowFragment` — no fetching, no loading/error branch,
 * the parent (`page/library`) already has the data. Only consumer is the
 * grid (`page/library`), so unlike `BookRow` this needed no REST adapter
 * split — see task 7's report for why `BookRow` did.
 *
 * `CoverStack` now reads straight off this same fragment's
 * `books(first: 3)` selection (above) instead of its own
 * separate REST fetch — final-branch-review C-1: `CoverStack`'s old
 * `useSeriesBookList` REST path filtered the SAME 20-entry-capped list
 * `page/library` used to grow via REST `fetchMore`, and nothing has grown
 * that list since Task 11 deleted that mechanism in favor of this
 * fragment's own GraphQL pagination — past roughly grid entry 20, the REST
 * list had never seen the series at all, so every stack past that point
 * rendered three ghosts regardless of whether the books actually had
 * covers. Mapping `hasCover ? thumbnailUrl : null` per node here matches
 * `BookRowFromEntry`'s own pattern for the grid's book rows exactly — a
 * server-built, already `?user=`/`v=`-scoped URL, not a client-built one.
 *
 * The progress badge the REST version showed (`useMySeriesProgress`), which
 * task 7 dropped because no such field existed on either transport, is
 * restored here (task 14): `unmasked.progressPercentage` carries
 * `Series.progressPercentage`, the server's aggregate over the same
 * semantics `useMySeriesProgress` used: the mean of each member book's
 * percentage, `null` when none of them have started. Formatting matches
 * the REST version exactly (`< 1` → a rounded percentage, else "Completed"
 * — see `e2a17228`, "show 'Completed' text when series progress reaches
 * 100%").
 */
export function SeriesRow({ series }: SeriesRowProps) {
  const styles = useStyle();
  const navigate = useNavigate();
  const unmasked = useFragment(SeriesRowFragment, series);

  const handleNavigate = useCallback(() => {
    navigate(path.series(unmasked.name));
  }, [unmasked.name, navigate]);

  const coverBooks = unmasked.books.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    src: node.hasCover ? node.thumbnailUrl : null,
  }));

  const meta: string[] = [];
  if (unmasked.author) {
    meta.push(unmasked.author);
  }
  meta.push(`${unmasked.bookCount} book series`);
  if (unmasked.progressPercentage !== null) {
    meta.push(
      unmasked.progressPercentage < 1
        ? `${(unmasked.progressPercentage * 100).toFixed(0)}%`
        : 'Completed'
    );
  }

  return (
    <Card size="small" onClick={handleNavigate}>
      <div className={styles.root}>
        <CoverStack books={coverBooks} layerWidth={44} layerHeight={66} />
        <div className={styles.info}>
          <div className={styles.name}>{unmasked.name}</div>
          <div className={styles.meta}>{meta.join(' · ')}</div>
        </div>
      </div>
    </Card>
  );
}
