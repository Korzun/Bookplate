import type { Reference } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Fragment, useCallback, useState } from 'react';

import { Card, MetadataList } from '~/component';
import { DeviceForm } from '~/component/device-form';
import { Button, ConfirmModal } from '~/control';
import { graphql, useFragment, type FragmentType } from '~/gql';
import type { DeviceDeleteMutation } from '~/gql/graphql';
import { DeviceDeleteDocument } from '~/graphql/device';
import { AlertOctagonIcon } from '~/icon';
import { unwrapResult } from '~/provider/apollo';

import { formatCoverFit } from './cover-fit';
import { useStyle } from './style';

/**
 * Colocated: this component declares exactly the fields it renders, and
 * `page/device-list` composes it into `DeviceListDocument`. `coverFit` comes
 * through as the server's SCREAMING_CASE enum — see `./cover-fit.ts`.
 */
export const DeviceRowFragment = graphql(`
  fragment DeviceRowFragment on Device {
    id
    name
    slug
    coverWidth
    coverHeight
    coverFit
    bwCover
    simplify
  }
`);

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so it is named explicitly here, extracted from the generated
// union rather than hand-duplicated.
type DeviceDeletePayload = Extract<
  NonNullable<DeviceDeleteMutation['deviceDelete']>,
  { __typename: 'DeviceDeletePayload' }
>;

const formatCoverSize = (coverWidth: number | null, coverHeight: number | null) =>
  coverWidth !== null && coverHeight !== null ? `${coverWidth}×${coverHeight}` : 'Auto';

interface DeviceRowProps {
  device: FragmentType<typeof DeviceRowFragment>;
}

/**
 * `useFragment` is called exactly once, unconditionally, at the top of this
 * component's own body — before the `editing` early return — mirroring
 * `component/my-progress-row/index.tsx`.
 *
 * Delete is a direct `useMutation(DeviceDeleteDocument)` call here rather
 * than a dedicated hook: this row is its only caller. `optimisticResponse`
 * plus `cache.modify`/`cache.evict` in `update` mirror the REST-era
 * `useDeleteDevice` hook exactly — `cache.modify` filters the reference out
 * of `Viewer.devices` (takes effect immediately during the optimistic pass,
 * since `evict` alone cannot escape an active optimistic layer), and
 * `cache.evict` removes the normalized `Device` entity once the deletion is
 * confirmed. A thrown/typed error leaves the optimistic layer to be
 * discarded by Apollo, or never runs the filter/evict against the root
 * layer — no hand-written rollback needed either way.
 */
export const DeviceRow = ({ device }: DeviceRowProps) => {
  const styles = useStyle();
  const unmasked = useFragment(DeviceRowFragment, device);
  const [runDelete] = useMutation(DeviceDeleteDocument);
  const [deleting, setDeleting] = useState<boolean>(false);

  const [editing, setEditing] = useState<boolean>(false);
  const handleEdit = useCallback(() => setEditing(true), []);
  const handleEditDone = useCallback(() => setEditing(false), []);

  const [showDeleteDeviceModal, setShowDeleteDeviceModal] = useState<boolean>(false);
  const handleDeleteDevice = useCallback(() => {
    setShowDeleteDeviceModal(true);
  }, []);
  const handleDeleteDeviceCancel = useCallback(() => {
    setShowDeleteDeviceModal(false);
  }, []);
  const handleDeleteDeviceConfirm = useCallback(async () => {
    setShowDeleteDeviceModal(false);
    const deviceId = unmasked.id;
    setDeleting(true);
    try {
      await runDelete({
        variables: { input: { deviceId } },
        optimisticResponse: {
          __typename: 'Mutation',
          deviceDelete: { __typename: 'DeviceDeletePayload', deletedDeviceId: deviceId },
        },
        update: (cache, { data: mutationData }) => {
          const result = unwrapResult<DeviceDeletePayload>(
            mutationData?.deviceDelete,
            'DeviceDeletePayload'
          );
          if (result.status !== 'ok') return;

          const deletedDeviceId = result.payload.deletedDeviceId;

          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              devices: (existing: readonly Reference[] = [], { readField }) =>
                existing.filter((deviceRef) => readField('id', deviceRef) !== deletedDeviceId),
            },
          });

          cache.evict({
            id: cache.identify({ __typename: 'Device', id: deletedDeviceId }),
          });
        },
      });
    } finally {
      setDeleting(false);
    }
  }, [runDelete, unmasked.id]);

  if (editing) {
    return <DeviceForm device={unmasked} onDone={handleEditDone} />;
  }

  return (
    <Fragment>
      <Card
        title={unmasked.name}
        headerAction={
          <div className={styles.rowActions}>
            <Button type="link" onClick={handleEdit}>
              Edit
            </Button>
            <Button type="link" danger onClick={handleDeleteDevice} loading={deleting}>
              Delete
            </Button>
          </div>
        }
      >
        <MetadataList
          metadata={[
            { title: 'Slug', value: unmasked.slug },
            {
              title: 'Cover size',
              value: formatCoverSize(unmasked.coverWidth, unmasked.coverHeight),
            },
            { title: 'Cover fit', value: formatCoverFit(unmasked.coverFit) },
            { title: 'Grayscale Cover', value: unmasked.bwCover ? 'Yes' : 'No' },
            { title: 'Simplify', value: unmasked.simplify ? 'Yes' : 'No' },
          ]}
        />
      </Card>
      <ConfirmModal
        isOpen={showDeleteDeviceModal}
        onCancel={handleDeleteDeviceCancel}
        onConfirm={() => void handleDeleteDeviceConfirm()}
        icon={AlertOctagonIcon}
        danger
        title="Delete device permanently?"
        confirmText="Delete"
        loading={deleting}
      >
        This action will delete <span className={styles.deviceName}>{unmasked.name}</span>, and any
        per-device book editions generated for it, and{' '}
        <span className={styles.undone}>can not be undone</span>.
      </ConfirmModal>
    </Fragment>
  );
};
