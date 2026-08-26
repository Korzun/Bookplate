import { DeviceRow, DeviceRowFragment } from '~/component/device-row';
import { useFragment, type FragmentType } from '~/gql';

import { useStyle } from './style';

interface DeviceListProps {
  devices: FragmentType<typeof DeviceRowFragment>[];
  loading: boolean;
  error?: string;
}

/**
 * Fetch-free: `page/device-list` composes `DeviceListDocument` from
 * `DeviceRowFragment` and passes the result straight through. `useFragment`
 * is called once, unconditionally, at the top of this body — with an ARRAY
 * of refs, one of the masking helper's supported overloads — purely to read
 * `id`/`name` for sorting and row keys; the ORIGINAL (still masked) refs are
 * what get handed to each `DeviceRow`, unchanged, since `useFragment` is a
 * type-only unmask (no runtime transform) and `DeviceRow` does its own
 * unconditional unmask of the exact same ref.
 *
 * The server already returns `orderBy: { name: 'asc' }`, but a future
 * `cache.modify` append (`DeviceForm`'s create path) is not guaranteed to
 * land in name order, so this still sorts where the list is rendered rather
 * than relying on that ordering guarantee.
 */
export const DeviceList = ({ devices: deviceRefs, loading, error }: DeviceListProps) => {
  const styles = useStyle();
  const unmaskedDevices = useFragment(DeviceRowFragment, deviceRefs);

  const sortedRows = deviceRefs
    .map((ref, index) => ({
      ref,
      id: unmaskedDevices[index].id,
      name: unmaskedDevices[index].name,
    }))
    .sort((rowA, rowB) => rowA.name.localeCompare(rowB.name));

  if (loading) return <p className={styles.loading}>Loading…</p>;

  // Checked before the empty-list branch below: an empty array is what a
  // failed read also returns, so without this a GraphQL error renders
  // identically to "you really have no devices" instead of saying what
  // happened.
  if (error !== undefined) {
    return <p className={styles.loading}>{error}</p>;
  }

  if (sortedRows.length === 0) {
    return <p className={styles.loading}>No devices yet</p>;
  }

  return (
    <div className={styles.root}>
      {sortedRows.map((row) => (
        <DeviceRow key={row.id} device={row.ref} />
      ))}
    </div>
  );
};
