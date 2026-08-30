import { useQuery } from '@apollo/client/react';
import { useCallback } from 'react';

import {
  BookRequests,
  ConnectionUrls,
  MyProgress,
  Page,
  ScanLibrarySetting,
  SyncPassword,
  ThemeSetting,
  UserChangePassword,
} from '~/component';
import { Button } from '~/control';
import { graphql } from '~/gql';
import { useIsAdmin, useLogout } from '~/provider/auth';

/**
 * Composed at the ROUTE. This carries only what `ConnectionUrls` renders
 * (Ruling C, task 1): `ConnectionUrls` is the second consumer of the old
 * REST-era device list, and this is its route.
 *
 * **Do NOT extend this document with `MyProgress`/`MyProgressContent`'s
 * progress selection.** An earlier version of this comment instructed
 * exactly that; what SHIPPED is the opposite, deliberately.
 * `MyProgressListDocument` lives on `component/my-progress-content` because
 * that component is mounted only while its `Card` is EXPANDED (spec 3.4's
 * lazy gate) — hoisting it here would turn a collapsed-card subtree's
 * conditional read into an unconditional, breadth-32 / complexity-2507
 * fetch on every visit to this route. See that component's own doc comment
 * for the full reasoning. The "one request per screen" rule the spec states
 * yields to the lazy-mount exception here; it is not being violated by
 * accident.
 *
 * `...ConnectionUrlsFragment` below is resolved by name against
 * `component/connection-urls`'s own `graphql(...)` definition — codegen
 * matches fragments across files by name (its `documents` glob), not via a
 * JS import.
 *
 * Skipped entirely for admins (`skip: isAdmin` below): `ConnectionUrls`
 * renders only in the non-admin branch, and `Viewer.devices` carries a ×100
 * cost multiplier, so an admin visiting this page should not pay for a
 * device fetch it never displays.
 */
export const UserPageDocument = graphql(`
  query UserPage {
    viewer {
      devices {
        ...ConnectionUrlsFragment
      }
    }
  }
`);

export const UserPage = () => {
  const [isAdmin] = useIsAdmin();
  const { data } = useQuery(UserPageDocument, { skip: isAdmin });

  const [logout, loggingOut] = useLogout();
  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  if (isAdmin) {
    return (
      <Page>
        <ThemeSetting />
        <ScanLibrarySetting />
        <Button loading={loggingOut} onClick={handleLogout} danger>
          Log out
        </Button>
      </Page>
    );
  }

  return (
    <Page>
      <ThemeSetting />
      <ScanLibrarySetting />
      <SyncPassword />
      <BookRequests />
      <ConnectionUrls devices={data?.viewer.devices ?? []} />
      <UserChangePassword />
      <MyProgress />
      <Button loading={loggingOut} onClick={handleLogout} danger>
        Log out
      </Button>
    </Page>
  );
};
