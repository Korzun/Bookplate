import { useQuery } from '@apollo/client/react';

import { MyProgressCountDocument } from '~/graphql/progress';

import { Card } from '../card';
import { MyProgressContent } from '../my-progress-content';
import { useStyle } from './style';

/**
 * The "N books synced" subtitle now reads `MyProgressCountDocument` — a
 * dedicated, cheap query — rather than the whole progress list. The REST
 * version's `MyProgress` called `useMyProgressList()` directly (fetching
 * every row) just to `Object.keys(...).length` it for this count; today's
 * REST version therefore fetches the full list on mount REGARDLESS of
 * whether the card is expanded, which this is strictly less work than.
 *
 * Row fetching itself is NOT wired through here: `MyProgressContent`, this
 * component's child, owns `MyProgressListDocument` and reads it on its own
 * — and `Card` (`isCollapsible`/`defaultCollapsed` below) does not render
 * its children into the tree at all while collapsed
 * (`component/card/index.tsx`'s `visibleChildren`), so `MyProgressContent`
 * is never even mounted, and never fetches a row, until the card is
 * actually expanded. `skip={false}` below is always correct at this one
 * call site — see `MyProgressContent`'s own doc comment for the full
 * mechanism and for why `skip` is still an explicit, required prop despite
 * never varying here.
 *
 * `viewer.user` is NULLABLE and is `null` for the config-based admin, which
 * has no `User` row (`graphql/progress.ts`'s doc comment). This mirrors what
 * the REST screen already did here: REST's `useMyProgressList` returned an
 * ERROR ("User not logged in") whenever `username` was `undefined` — always
 * true for the admin — and the old `MyProgress` destructured only the
 * data tuple element, so `progressList` stayed `undefined` and `subTitle`
 * fell through to its `undefined` branch. Rendering no subtitle here for
 * `progressCount === undefined` (loading OR admin) reaches the same
 * observable outcome for the analogous reason under the new shape.
 */
export const MyProgress = () => {
  const styles = useStyle();
  const { data } = useQuery(MyProgressCountDocument);
  const progressCount = data?.viewer.user?.progressCount;

  return (
    <Card
      title="Progress"
      isCollapsible
      defaultCollapsed
      subTitle={
        progressCount !== undefined
          ? `${progressCount} book${progressCount === 1 ? '' : 's'} synced`
          : undefined
      }
    >
      <div className={styles.content}>
        <MyProgressContent skip={false} />
      </div>
    </Card>
  );
};
