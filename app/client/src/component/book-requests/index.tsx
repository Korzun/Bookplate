import { useQuery } from '@apollo/client/react';

import { MyBookRequestCountDocument } from '~/graphql/book-request';

import { BookRequestsContent } from '../book-requests-content';
import { Card } from '../card';
import { useStyle } from './style';

/**
 * The reader's request card on `/user`. Mirrors `MyProgress`: the subtitle
 * reads a cheap dedicated count query, and `Card`'s
 * `isCollapsible`/`defaultCollapsed` pair does not render children into the
 * tree while collapsed — so `BookRequestsContent` is never mounted, and never
 * fetches a row, until the card is expanded. `skip={false}` is therefore always
 * correct at this one call site.
 *
 * Rendered only in `/user`'s NON-ADMIN branch: the config admin has no `User`
 * row, so `viewer.user` is null and it cannot be a requester.
 */
export const BookRequests = () => {
  const styles = useStyle();
  const { data } = useQuery(MyBookRequestCountDocument);
  const pending = data?.viewer.user?.pendingBookRequestCount;

  return (
    <Card
      title="Book requests"
      isCollapsible
      defaultCollapsed
      subTitle={
        pending !== undefined ? `${pending} request${pending === 1 ? '' : 's'} pending` : undefined
      }
    >
      <div className={styles.content}>
        <BookRequestsContent skip={false} />
      </div>
    </Card>
  );
};
