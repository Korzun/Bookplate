import { useQuery } from '@apollo/client/react';
import { useMemo } from 'react';

import { DeviceListDocument } from '~/graphql/device';

import type { Device } from '../type';
import { coverFitFromGraphQL } from './util';

export const sortDeviceList = (deviceA: Device, deviceB: Device) =>
  deviceA.name.localeCompare(deviceB.name);

export type UseDeviceList =
  | [Device[], true, false, undefined]
  | [Device[], false, false, undefined]
  | [Device[], false, true, undefined]
  | [Device[], false, true, string];

/**
 * The device list, read over GraphQL.
 *
 * `Viewer.devices` already resolves `orderBy: { name: 'asc' }` server-side
 * (`services/device-store.ts`), so this hook's own `sortDeviceList` pass over
 * the result is redundant for THIS read. It is kept anyway: this is the same
 * hook `component/device-list` and `component/connection-urls` will keep
 * reading after a future mutation task appends into the cache via
 * `cache.modify` (see `~/graphql/device`'s comment on the `Viewer` singleton
 * enabling that). An append is not guaranteed to land in name order, and
 * re-sorting here decouples the consumers' ordering guarantee from that cache
 * write's implementation detail, at the cost of a no-op sort over a short list
 * on the common path.
 */
export const useDeviceList = (): UseDeviceList => {
  const { data, loading, error } = useQuery(DeviceListDocument);

  return useMemo(() => {
    if (error !== undefined) {
      return [[], false, true, error.message] as UseDeviceList;
    }

    const devices: Device[] = (data?.viewer.devices ?? [])
      .map(
        (device): Device => ({
          id: device.id,
          name: device.name,
          slug: device.slug,
          coverWidth: device.coverWidth,
          coverHeight: device.coverHeight,
          coverFit: coverFitFromGraphQL(device.coverFit),
          bwCover: device.bwCover,
          simplify: device.simplify,
        })
      )
      .sort(sortDeviceList);

    return [devices, loading, false, undefined] as UseDeviceList;
  }, [data, loading, error]);
};
