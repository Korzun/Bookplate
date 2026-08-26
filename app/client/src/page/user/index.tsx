import { useQuery } from '@apollo/client/react';
import { useCallback } from 'react';

import {
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
 * Composed at the ROUTE. Today this carries only what `ConnectionUrls`
 * renders (Ruling C, task 1): `ConnectionUrls` is the second consumer of the
 * old REST-era device list, and this is its route. A later task EXTENDS this
 * SAME document with the progress fragments `MyProgress`/`MyProgressContent`
 * need, rather than adding a second document — two documents on one route
 * means two requests per screen, which the spec forbids.
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
      <ConnectionUrls devices={data?.viewer.devices ?? []} />
      <UserChangePassword />
      <MyProgress />
      <Button loading={loggingOut} onClick={handleLogout} danger>
        Log out
      </Button>
    </Page>
  );
};
