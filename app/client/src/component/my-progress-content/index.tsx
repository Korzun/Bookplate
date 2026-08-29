import cx from 'classnames';
import { Fragment } from 'react';

import { Button } from '~/control';
import { graphql } from '~/gql';
import type { MyProgressListQuery } from '~/gql/graphql';
import { usePaginatedConnection } from '~/lib/use-paginated-connection';
import { useCurrentLibraryId } from '~/provider/library-target';

import { MyProgressRow } from '../my-progress-row';
import { useStyle } from './style';

/**
 * The viewer's own progress. This screen pages forward only, by choice — a
 * scrolling list has nothing to page backward INTO. `Library.progress` itself
 * does accept `last`/`before` (it is a `t.prismaConnection` server-side; it
 * did not always, hence this note). `PAGE_SIZE` (below) matches
 * `CONNECTION_LIMITS.libraryProgress.defaultSize`; the server's cap is 100,
 * and an oversize `first` OR `last` is rejected, never clamped.
 *
 * `$first` is a VARIABLE in this document (not a literal), so
 * `Library.progress` is PRICED at its `maxSize` (100) regardless of what a
 * caller actually passes (`cost-limit.ts`'s `multiplierFor` prices a
 * variable-valued `first`/`last` at the field's max, not its default) — the
 * measured numbers below already reflect that worst case, not the 50 a
 * well-behaved caller sends.
 *
 * Declared HERE rather than a route file or `graphql/progress.ts` (project
 * ruling J): this component is a CHILD of `Card`'s
 * `isCollapsible`/`defaultCollapsed` pair (`component/my-progress`), which
 * does not render its children into the tree AT ALL while collapsed
 * (`visibleChildren = isExpanded ? children : null`,
 * `component/card/index.tsx`) — so this component, and the query it owns,
 * is never even MOUNTED until the card is expanded. That mount/unmount IS
 * the lazy gate spec 3.4 asks for; hoisting this document to `page/user`
 * (spec 3.1's normal "the route composes the query" rule) would fetch it
 * unconditionally on every visit to that route instead.
 *
 * Measured (`npm run test:cost -w app/server`): breadth 32 (32.0%), complexity
 * 2507 (7.6%) of budget.
 */
export const MyProgressListDocument = graphql(`
  query MyProgressList($libraryId: ID!, $first: Int!, $after: String) {
    node(id: $libraryId) {
      id
      ... on Library {
        id
        progress(first: $first, after: $after) {
          edges {
            cursor
            node {
              id
              ...ProgressRowFragment
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`);

/**
 * `Library.progress`'s own `defaultSize` (`CONNECTION_LIMITS.libraryProgress`
 * is `{ maxSize: 100, defaultSize: 50 }`, `app/server/graphql/schema/pagination.ts`)
 * — `MyProgressListDocument`'s own doc comment already recommends `first: 50`
 * for exactly this reason. `$first` is non-null on the document, so this
 * component must always supply a value.
 */
const PAGE_SIZE = 50;

type LibraryNode = Extract<NonNullable<MyProgressListQuery['node']>, { __typename: 'Library' }>;

/**
 * Deliberately still MASKED here, mirroring `page/library/index.tsx`'s
 * `LibraryEntryEdge` (that type moved onto the page when Task 5 deleted
 * `use-library-entries.ts`): `node` carries a `FragmentType` ref for
 * `ProgressRowFragment`, not the unwrapped fields. Unlike that hook's
 * `edges`, this one is HOMOGENEOUS (every node is a `Progress`, never a
 * union of types), so returning unmasked data here would not itself trip
 * the `react-hooks/rules-of-hooks` hazard that forces `LibraryEntryEdge` to
 * stay masked. The masked shape is kept anyway, for the same reason every
 * other fetch-free row this migration has built keeps it: `MyProgressRow`
 * calls `useFragment` exactly once, unconditionally, in its own render
 * context, and that is the pattern every sibling row (`BookRowFromEntry`,
 * `SeriesRow`) already follows — one shape across the codebase beats an
 * exception for the one case where nothing technically forces it.
 *
 * `id` stays visible WITHOUT unmasking — it is a sibling selection on
 * `node` alongside the fragment spread (`node { id ...ProgressRowFragment
 * }` in `MyProgressListDocument`), not a field the fragment itself pulls
 * in, exactly like `__typename`/`cursor` on `LibraryEntryEdge`. That is
 * enough for this component to key each row in its `.map()` without
 * unmasking anything.
 */
type MyProgressRowRef = LibraryNode['progress']['edges'][number]['node'];

interface MyProgressContentProps {
  /**
   * **What makes the collapsed card fetch nothing.** This component's own
   * PARENT (`MyProgress`) always passes `false` at its one production call
   * site — `MyProgress` itself never mounts this component while `Card` is
   * collapsed (`Card` does not render its children into the tree at all
   * while collapsed, see this file's own `MyProgressListDocument` doc
   * comment), so `skip` is always `false` in practice there. `skip` stays a
   * required, EXPLICIT prop regardless — rather than defaulting to `false`
   * internally — so this component's own tests can gate the query directly
   * instead of depending on `Card`'s mount timing as an implicit contract.
   */
  skip: boolean;
}

/**
 * A CHILD of `Card`'s `isCollapsible`/`defaultCollapsed` pair
 * (`component/my-progress`), which does not render its children into the
 * tree at all while collapsed — so this component is only ever MOUNTED
 * while the card is expanded, and `skip: false` is always what `MyProgress`
 * passes at that one call site. See `MyProgressListDocument`'s own doc
 * comment for the full mechanism.
 *
 * Skips the query outright when `libraryId` is `undefined` too — an admin
 * with no library selected has nothing to root `node(id:)` on — same as
 * `page/library`. The `skip` passed to `usePaginatedConnection` below
 * is therefore the COMBINED condition (`skip || libraryId === undefined`).
 *
 * **`loading` also covers `useCurrentLibraryId`'s own bootstrap round
 * trip**, same fix as `page/library` — UNLESS `skip` is explicitly
 * `true`, in which case there is nothing mounted to show a loading state
 * for, so `loading` reports `false` regardless of `useCurrentLibraryId`'s
 * own state. That "regardless" is why `extraLoading` below is computed as
 * `skip ? false : libraryIdLoading` rather than passed straight through:
 * `usePaginatedConnection` simply ORs whatever `extraLoading` it is given
 * (see that helper's own doc comment for why it can't gate the fold on its
 * own combined `skip`), so this component pre-zeroes it for its own
 * explicit-`skip` case.
 *
 * **Error-surfacing policy** — identical split to `page/library`, both
 * implemented by `usePaginatedConnection` (see that helper's own doc
 * comment for the full policy): a first-page failure is `useQuery`'s own
 * `error`, with `rows` empty (the empty-error state). A `fetchMore` failure
 * is caught locally and surfaced through the same `error` field, with rows
 * left untouched (existing rows survive, offer a retry).
 *
 * Renders rows fetch-free off `MyProgressList`'s connection: each
 * `MyProgressRow` unmasks its own `ProgressRowFragment` ref rather than
 * this component calling `useBook`/`useMyProgress` per row (the old REST
 * shape) or unmasking centrally in this `.map()` — a shared unmask here
 * would collide with `react-hooks/rules-of-hooks`.
 */
export const MyProgressContent = ({ skip }: MyProgressContentProps) => {
  const styles = useStyle();
  const { libraryId, loading: libraryIdLoading } = useCurrentLibraryId();

  const { edges, loading, loadingMore, error, hasNextPage, loadMore } = usePaginatedConnection({
    document: MyProgressListDocument,
    variables: { libraryId: libraryId ?? '', first: PAGE_SIZE },
    skip: skip || libraryId === undefined,
    select: (data) => (data?.node?.__typename === 'Library' ? data.node.progress : undefined),
    extraLoading: skip ? false : libraryIdLoading,
    resetKey: `${libraryId}:${skip}`,
    loadMoreErrorMessage: 'Failed to load more progress',
  });
  const rows: MyProgressRowRef[] = edges.map((edge) => edge.node);

  if (loading) {
    return <div className={styles.message}>Loading...</div>;
  }
  // A first-page failure (no rows loaded yet) is the empty-error state. A
  // `fetchMore` failure with existing rows falls through to the list below,
  // which renders its own inline retry instead of replacing the rows.
  if (error && rows.length === 0) {
    return <div className={cx(styles.message, styles.error)}>Error loading progress</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.message}>No progress synced</div>;
  }

  return (
    <Fragment>
      {rows.map((row) => (
        <MyProgressRow key={row.id} progress={row} libraryId={libraryId} />
      ))}
      {hasNextPage && (
        <Button type="link" onClick={loadMore} loading={loadingMore}>
          Load more
        </Button>
      )}
      {error && rows.length > 0 && (
        <div className={cx(styles.message, styles.error)}>
          Failed to load more progress
          <Button type="link" onClick={loadMore}>
            Retry
          </Button>
        </div>
      )}
    </Fragment>
  );
};
