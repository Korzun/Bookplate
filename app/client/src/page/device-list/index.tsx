import { useQuery } from '@apollo/client/react';

import { DeviceForm, DeviceList, Page } from '~/component';
import { graphql } from '~/gql';

/**
 * Composed at the ROUTE from the fragments its components export — one
 * request per screen, authored by the components that use the data.
 * `...DeviceRowFragment` below is resolved by name against
 * `component/device-row`'s own `graphql(...)` definition — codegen matches
 * fragments across files by name (its `documents` glob), not via a JS
 * import, so this document needs no import of that fragment to compile.
 *
 * `Viewer.devices` carries a ×100 cost multiplier and `Device.enabledUsers`
 * a further ×50 ON TOP, so a field under both is priced ×5000. This
 * document deliberately does NOT select `enabledUsers`; `DeviceForm`
 * fetches those separately (`DeviceUsersDocument`), only while its own edit
 * form is open.
 */
export const DeviceListDocument = graphql(`
  query DeviceList {
    viewer {
      devices {
        ...DeviceRowFragment
      }
    }
  }
`);

export const DeviceListPage = () => {
  const { data, loading, error } = useQuery(DeviceListDocument);
  return (
    <Page>
      <DeviceForm />
      <DeviceList devices={data?.viewer.devices ?? []} loading={loading} error={error?.message} />
    </Page>
  );
};
