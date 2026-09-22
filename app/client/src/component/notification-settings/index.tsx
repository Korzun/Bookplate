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
 * this component's own job is the toggle mutation and the state machine
 * around it, not the read.
 *
 * A successful toggle is reflected TWICE: immediately, via local override
 * state keyed by `event:channel` (so a row updates without waiting on a
 * round trip — the same pattern `component/email-setting` uses), and
 * durably, via `cache.modify` on the `Viewer` singleton — the mutation
 * payload already carries the FULL, authoritative list, so this is a direct
 * write rather than a second network round trip (`component/sync-password`
 * takes the identical approach for `Viewer.syncPassword`).
 */
export const NotificationSettings = ({ preferences, emailVerified }: NotificationSettingsProps) => {
  const style = useStyle();
  const showToast = useToast();
  const client = useApolloClient();
  const rows = useFragment(NotificationPreferenceFragment, preferences);

  // Local overrides, applied on top of the fetched rows once a mutation
  // succeeds — absent means "no override, use the row's own `enabled`".
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const [setPreference] = useMutation(ViewerSetNotificationPreferenceDocument);

  const handleToggle = useCallback(
    async (event: NotificationEvent, channel: NotificationChannel, enabled: boolean) => {
      try {
        const { data } = await setPreference({ variables: { event, channel, enabled } });
        const updated = data?.viewerSetNotificationPreference?.notificationPreferences;
        if (!updated) {
          showToast('Could not save that preference', 'error');
          return;
        }

        setOverrides((prev) => {
          const next = { ...prev };
          for (const row of updated) next[rowKey(row.event, row.channel)] = row.enabled;
          return next;
        });
        client.cache.modify({
          id: client.cache.identify({ __typename: 'Viewer' }),
          fields: { notificationPreferences: () => updated },
        });
      } catch {
        showToast('Could not save that preference', 'error');
      }
    },
    [setPreference, client, showToast]
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
          return (
            <Switch
              key={key}
              name={key}
              label={EVENT_LABEL[row.event]}
              layout="horizontal"
              checked={overrides[key] ?? row.enabled}
              disabled={!emailVerified}
              onChange={(next) => void handleToggle(row.event, row.channel, next)}
            />
          );
        })}
      </div>
    </Card>
  );
};
