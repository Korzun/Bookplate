import { useApolloClient, useMutation } from '@apollo/client/react';
import { useCallback, useState } from 'react';

import { Card } from '~/component';
import { Switch } from '~/control';
import { type FragmentType, useFragment } from '~/gql';
import type { NotificationChannel, NotificationEvent } from '~/gql/graphql';
import {
  NotificationPreferenceFragment,
  ViewerSetNotificationPreferenceDocument,
} from '~/graphql/notification';
import { useToast } from '~/provider/toast';

import { useStyle } from './style';

const EVENT_LABEL: Record<NotificationEvent, string> = {
  BOOK_REQUEST_CREATED: 'A reader requests a book',
  BOOK_REQUEST_FULFILLED: 'A book I requested is added to my library',
  BOOK_REQUEST_DECLINED: 'A book I requested is declined',
};

const rowKey = (event: NotificationEvent, channel: NotificationChannel) => `${event}:${channel}`;

export type NotificationSettingsProps = {
  /**
   * The server's catalogue: already filtered to this viewer's audience
   * (e.g. only an admin ever sees `BOOK_REQUEST_CREATED`) and empty when
   * this install has no channel configured. Rendered GROUPED BY EVENT —
   * one row per entry the server returns — rather than one hardcoded
   * toggle per known event, so a second channel becomes another row here
   * instead of a rewrite.
   */
  preferences: readonly FragmentType<typeof NotificationPreferenceFragment>[];
  emailVerified: boolean;
};

/**
 * `page/user`'s notifications card. `preferences`/`emailVerified` are handed
 * down as props (`page/user` reads them off `ViewerBootstrapDocument`,
 * mirroring `component/email-setting`) rather than fetched here directly —
 * this component's own job is the toggle mutation, not the read, and it
 * holds no PERSISTENT local copy of the list: absent a mutation of its own in
 * flight, each row's `checked` is `row.enabled`, full stop.
 *
 * A successful toggle writes the mutation's returned list — the FULL,
 * authoritative state, not just the changed row — onto `Viewer.notificationPreferences`
 * via `cache.modify` (`component/sync-password` takes the identical approach
 * for `Viewer.syncPassword`). That write relies on `page/user`'s own
 * `useQuery(ViewerBootstrapDocument)` being an ACTIVE watched query, which
 * reacts to the cache write and re-renders this component with a fresh
 * `preferences` prop, the same way any other cache write (a mutation, a
 * refetch, `EmailSetting`'s own `client.refetchQueries`) would.
 *
 * The one piece of local state is `pending`: the row a click just fired a
 * mutation for shows the value the click asked for immediately, rather than
 * waiting out the round trip, and that value is cleared the instant its own
 * mutation settles — success or error — never lingering past the request it
 * was for. This is deliberately NOT the `overrides` map that was tried here
 * before and removed: that one copied EVERY row from every response and was
 * never cleared, so it stopped tracking the prop at all and could win over a
 * LATER refetch that lands genuinely fresher data (e.g. `EmailSetting`
 * refetching `ViewerBootstrapDocument` after a save). `pending` cannot go
 * stale that way because it holds at most the one row currently in flight and
 * disappears the moment that row's mutation resolves; on success the fresh
 * prop and the cleared `pending` entry agree, and on error the switch reverts
 * to the server's last known value. A row with an entry in `pending` also
 * cannot fire a second mutation until the first settles.
 */
export const NotificationSettings = ({ preferences, emailVerified }: NotificationSettingsProps) => {
  const style = useStyle();
  const showToast = useToast();
  const client = useApolloClient();
  const rows = useFragment(NotificationPreferenceFragment, preferences);

  const [setPreference] = useMutation(ViewerSetNotificationPreferenceDocument);

  /**
   * Keyed by `rowKey`. A row present here has a mutation in flight and shows
   * this value instead of `row.enabled`; the entry is removed in every
   * settlement path (success, server error, or thrown error) so it can never
   * outlive the request it was created for. See the file header for why this
   * is scoped to the one row in flight rather than a copy of the whole list.
   */
  const [pending, setPending] = useState<Partial<Record<string, boolean>>>({});

  const handleToggle = useCallback(
    async (event: NotificationEvent, channel: NotificationChannel, enabled: boolean) => {
      const key = rowKey(event, channel);
      if (key in pending) return; // this row's previous mutation hasn't settled yet

      setPending((prev) => ({ ...prev, [key]: enabled }));
      try {
        const { data } = await setPreference({ variables: { event, channel, enabled } });
        const updated = data?.viewerSetNotificationPreference?.notificationPreferences;
        if (!updated) {
          showToast('Could not save that preference', 'error');
          return;
        }

        client.cache.modify({
          id: client.cache.identify({ __typename: 'Viewer' }),
          fields: { notificationPreferences: () => updated },
        });
      } catch {
        showToast('Could not save that preference', 'error');
      } finally {
        setPending((prev) => {
          const { [key]: _settled, ...rest } = prev;
          return rest;
        });
      }
    },
    [pending, setPreference, client, showToast]
  );

  if (rows.length === 0) return null;

  return (
    <Card title="Notifications">
      {!emailVerified && (
        <p className={style.hint}>Confirm your email address above to start receiving these.</p>
      )}
      <div className={style.list}>
        {rows.map((row) => {
          const key = rowKey(row.event, row.channel);
          const checked = pending[key] ?? row.enabled;
          return (
            <Switch
              key={key}
              name={key}
              label={EVENT_LABEL[row.event]}
              layout="horizontal"
              checked={checked}
              disabled={!emailVerified}
              onChange={(next) => void handleToggle(row.event, row.channel, next)}
            />
          );
        })}
      </div>
    </Card>
  );
};
