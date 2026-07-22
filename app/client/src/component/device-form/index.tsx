import { useCallback, useEffect, useRef, useState } from 'react';

import { Card, CardDivider } from '~/component';
import { Button, ChipsInput, NumberInput, Select, Switch, TextInput } from '~/control';
import type { SelectOption } from '~/control';
import { useIsAdmin } from '~/provider/auth';
import {
  useCreateDevice,
  useDeviceUsers,
  useDisableDeviceUser,
  useEnableDeviceUser,
  useUpdateDevice,
} from '~/provider/device';
import type { Device, DeviceInput } from '~/provider/device';
import { useToast } from '~/provider/toast';
import { useUserList } from '~/provider/user';
import { isNumeric } from '~/utils';

import { useStyle } from './style';

const NAME_MAX_LENGTH = 50;

// Empty (cleared to "auto") or a positive integer, matching the server's
// `${label} must be a positive integer` validation in app/server/routes/devices.ts.
const isValidCoverDimension = (newValue: string) =>
  newValue === '' ||
  (isNumeric(newValue) && Number.isInteger(parseFloat(newValue)) && parseFloat(newValue) > 0);

const COVER_FIT_OPTIONS: SelectOption[] = [
  {
    label: 'Contain',
    value: 'contain',
    description: 'Fit the whole cover inside the size, adding padding if the aspect ratio differs.',
  },
  {
    label: 'Cover',
    value: 'cover',
    description: 'Fill the size completely and crop the overflow, keeping the aspect ratio.',
  },
  {
    label: 'Smart',
    value: 'smart',
    description:
      'Fill the size completely and crop automatically to keep the busiest part of the cover — usually the title. Needs a width and height.',
  },
  {
    label: 'Fill',
    value: 'fill',
    description: 'Stretch the cover to the exact size, ignoring its aspect ratio.',
  },
];

type DeviceFormProps = {
  // When provided, the form edits this existing device; otherwise it creates one.
  device?: Device;
  // Called after a successful edit save, or when editing is cancelled.
  onDone?: () => void;
};

export const DeviceForm = ({ device, onDone }: DeviceFormProps) => {
  const styles = useStyle();
  const showToast = useToast();
  const isEdit = device !== undefined;

  const [createDevice, creating, createHasError, createErrorMessage] = useCreateDevice();
  const [updateDevice, updating, updateHasError, updateErrorMessage] = useUpdateDevice();
  const loading = isEdit ? updating : creating;
  const hasError = isEdit ? updateHasError : createHasError;
  const errorMessage = isEdit ? updateErrorMessage : createErrorMessage;
  const lastErrorRef = useRef<boolean>(false);

  const [isAdmin] = useIsAdmin();
  const [allUsers] = useUserList();
  const userOptions = allUsers.map((u) => u.username);
  // Only fetch when the field will actually be shown — non-admins can still
  // open the edit form (Edit isn't gated), and the device users endpoint is
  // admin-only server-side.
  const [fetchedUsers, loadingUsers] = useDeviceUsers(isAdmin ? device?.id : undefined);
  const [enableUser] = useEnableDeviceUser();
  const [disableUser] = useDisableDeviceUser();
  // The Users chips field shows fetchedUsers (server truth) until the admin
  // edits it; editedUsers then takes over as the pending selection until Save
  // reconciles it back to the server and this resets to null. Deriving this
  // way (rather than syncing fetchedUsers into state via useEffect) avoids a
  // set-state-in-effect render loop, since useDeviceUsers returns a fresh []
  // on every render while loading.
  const [editedUsers, setEditedUsers] = useState<string[] | null>(null);
  const selectedUsers = editedUsers ?? fetchedUsers;

  const [name, setName] = useState<string>(device?.name ?? '');
  const [coverWidth, setCoverWidth] = useState<number | undefined>(device?.coverWidth ?? undefined);
  const [coverHeight, setCoverHeight] = useState<number | undefined>(
    device?.coverHeight ?? undefined
  );
  const [coverFit, setCoverFit] = useState<string | undefined>(device?.coverFit ?? 'contain');
  const [bwCover, setBwCover] = useState<boolean>(device?.bwCover ?? false);
  const [simplify, setSimplify] = useState<boolean>(device?.simplify ?? false);

  const handleNameChange = useCallback((newValue: string | undefined) => {
    setName(newValue ?? '');
  }, []);

  // Reconciles the chips' pending selection against fetchedUsers (server
  // truth) once the device has been created/updated and a device id exists.
  // Returns whether reconciliation fully succeeded, so callers can hold back
  // the success toast when it didn't (the error toast stands on its own).
  const reconcileUsers = useCallback(
    async (targetId: string) => {
      const toAdd = selectedUsers.filter((u) => !fetchedUsers.includes(u));
      const toRemove = fetchedUsers.filter((u) => !selectedUsers.includes(u));
      if (toAdd.length === 0 && toRemove.length === 0) return true;

      const results = await Promise.all([
        ...toAdd.map((u) => enableUser(targetId, u)),
        ...toRemove.map((u) => disableUser(targetId, u)),
      ]);
      if (results.some((ok) => ok === false)) {
        showToast('Some users could not be updated', 'error');
        return false;
      }
      return true;
    },
    [selectedUsers, fetchedUsers, enableUser, disableUser, showToast]
  );

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (trimmedName === '') return;

    const input: DeviceInput = {
      name: trimmedName,
      coverWidth: coverWidth ?? null,
      coverHeight: coverHeight ?? null,
      coverFit: (coverFit ?? 'contain') as Device['coverFit'],
      bwCover,
      simplify,
    };

    if (isEdit) {
      const updated = await updateDevice(device.id, input);
      if (updated === null) return;
      const reconciled = await reconcileUsers(device.id);
      if (reconciled) showToast(`Device "${updated.name}" updated`, 'success');
      onDone?.();
      return;
    }

    const created = await createDevice(input);
    if (created === null) return;
    const reconciled = await reconcileUsers(created.id);

    if (reconciled) showToast(`Device "${created.name}" created`, 'success');
    setName('');
    setCoverWidth(undefined);
    setCoverHeight(undefined);
    setCoverFit('contain');
    setBwCover(false);
    setSimplify(false);
    setEditedUsers(null);
  }, [
    isEdit,
    device,
    createDevice,
    updateDevice,
    reconcileUsers,
    name,
    coverWidth,
    coverHeight,
    coverFit,
    bwCover,
    simplify,
    showToast,
    onDone,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !loading) void handleSubmit();
    },
    [handleSubmit, loading]
  );

  // useCreateDevice()/useUpdateDevice() reset hasError/errorMessage at the start
  // of every attempt, so watching hasError's transition to true reliably fires
  // once per failed attempt (mirrors page/book-edit's errorMessage handling).
  useEffect(() => {
    if (hasError && !lastErrorRef.current) {
      showToast(errorMessage ?? `Failed to ${isEdit ? 'update' : 'create'} device`, 'error');
    }
    lastErrorRef.current = hasError;
  }, [hasError, errorMessage, isEdit, showToast]);

  const fields = (
    <div className={styles.container}>
      <TextInput
        name="name"
        value={name}
        onChange={handleNameChange}
        layout="horizontal"
        label="Name"
        placeholder="e.g. Kobo"
        autoComplete="off"
        maxLength={NAME_MAX_LENGTH}
        validate={(newValue) => newValue.length <= NAME_MAX_LENGTH}
        onKeyDown={handleKeyDown}
      />
      {isAdmin && (
        <ChipsInput
          name="users"
          label="Users"
          layout="horizontal"
          value={selectedUsers}
          suggestions={userOptions}
          onChange={setEditedUsers}
          allowCustom={false}
          disabled={loadingUsers}
          placeholder={loadingUsers ? 'Loading…' : 'Add users…'}
          chipColor="user"
          dense
        />
      )}
      <CardDivider>Cover</CardDivider>
      <NumberInput
        name="coverWidth"
        label="Width"
        value={coverWidth}
        onChange={setCoverWidth}
        validate={isValidCoverDimension}
      />
      <NumberInput
        name="coverHeight"
        label="Height"
        value={coverHeight}
        onChange={setCoverHeight}
        validate={isValidCoverDimension}
      />
      <Select
        name="coverFit"
        label="Fit"
        value={coverFit}
        options={COVER_FIT_OPTIONS}
        onChange={setCoverFit}
        searchable={false}
      />
      <Switch
        name="bwCover"
        label="Grayscale"
        checked={bwCover}
        onChange={setBwCover}
        description="Convert cover to grayscale for monochrome screens."
      />
      <CardDivider>Content</CardDivider>
      <Switch
        name="simplify"
        label="Simplify markup"
        checked={simplify}
        onChange={setSimplify}
        description="Replaces quote tags and special character codes in the book with plain equivalents, so simpler e-readers (such as Crosspoint) render the text correctly. Enable it for devices that struggle with complex formatting."
      />
    </div>
  );

  // Create renders its action inline in the body; edit keeps Cancel/Save in the
  // card footer. In edit mode the card replaces the device row's view card.
  const footer = isEdit ? (
    <>
      <Button radius="card" type="text" disabled={loading} onClick={onDone}>
        Cancel
      </Button>
      <Button
        type="primary"
        radius="card"
        loading={loading}
        disabled={name.trim() === ''}
        onClick={handleSubmit}
      >
        {loading ? 'Saving…' : 'Save'}
      </Button>
    </>
  ) : undefined;

  return (
    <Card allowOverflow title={isEdit ? device.name : 'Add new Device'} footer={footer}>
      {fields}
      {!isEdit && (
        <Button
          className={styles.submit}
          type="primary"
          radius="card"
          loading={loading}
          disabled={name.trim() === ''}
          onClick={handleSubmit}
        >
          {loading ? 'Adding…' : 'Add device'}
        </Button>
      )}
    </Card>
  );
};
