import { Fragment, useCallback, useState } from 'react';

import { Card, MetadataList } from '~/component';
import { DeviceForm } from '~/component/device-form';
import { Button, ConfirmModal } from '~/control';
import { AlertOctagonIcon } from '~/icon';
import { useDeleteDevice, useDeviceList } from '~/provider/device';
import type { Device } from '~/provider/device';

import { useStyle } from './style';

const formatCoverSize = (device: Device) =>
  device.coverWidth !== null && device.coverHeight !== null
    ? `${device.coverWidth}×${device.coverHeight}`
    : 'Auto';

const formatCoverFit = (fit: Device['coverFit']) => fit.charAt(0).toUpperCase() + fit.slice(1);

type DeviceRowProps = { device: Device };
const DeviceRow = ({ device }: DeviceRowProps) => {
  const styles = useStyle();
  const [deleteDevice, deleting] = useDeleteDevice();

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
  const handleDeleteDeviceConfirm = useCallback(() => {
    setShowDeleteDeviceModal(false);
    deleteDevice(device.id);
  }, [deleteDevice, device.id]);

  if (editing) {
    return <DeviceForm device={device} onDone={handleEditDone} />;
  }

  return (
    <Fragment>
      <Card
        title={device.name}
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
            { title: 'Slug', value: device.slug },
            { title: 'Cover size', value: formatCoverSize(device) },
            { title: 'Cover fit', value: formatCoverFit(device.coverFit) },
            { title: 'Grayscale Cover', value: device.bwCover ? 'Yes' : 'No' },
            { title: 'Simplify', value: device.simplify ? 'Yes' : 'No' },
          ]}
        />
      </Card>
      <ConfirmModal
        isOpen={showDeleteDeviceModal}
        onCancel={handleDeleteDeviceCancel}
        onConfirm={handleDeleteDeviceConfirm}
        icon={AlertOctagonIcon}
        danger
        title="Delete device permanently?"
        confirmText="Delete"
      >
        This action will delete <span className={styles.deviceName}>{device.name}</span>, and any
        per-device book editions generated for it, and{' '}
        <span className={styles.undone}>can not be undone</span>.
      </ConfirmModal>
    </Fragment>
  );
};

export const DeviceList = () => {
  const styles = useStyle();
  const [deviceList, loading] = useDeviceList();

  if (loading) return <p className={styles.loading}>Loading…</p>;

  if (deviceList.length === 0) {
    return <p className={styles.loading}>No devices yet</p>;
  }

  return (
    <div className={styles.root}>
      {deviceList.map((device) => (
        <DeviceRow key={device.id} device={device} />
      ))}
    </div>
  );
};
