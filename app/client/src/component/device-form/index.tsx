import { useCallback, useEffect, useRef, useState } from 'react';

import { Card } from '~/component';
import { Button, NumberInput, Select, Switch, TextInput } from '~/control';
import type { SelectOption } from '~/control';
import { useCreateDevice, useUpdateDevice } from '~/provider/device';
import type { Device, DeviceInput } from '~/provider/device';
import { useToast } from '~/provider/toast';
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
      showToast(`Device "${updated.name}" updated`, 'success');
      onDone?.();
      return;
    }

    const created = await createDevice(input);
    if (created === null) return;

    showToast(`Device "${created.name}" created`, 'success');
    setName('');
    setCoverWidth(undefined);
    setCoverHeight(undefined);
    setCoverFit('contain');
    setBwCover(false);
    setSimplify(false);
  }, [
    isEdit,
    device,
    createDevice,
    updateDevice,
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
      <NumberInput
        name="coverWidth"
        label="Cover width"
        value={coverWidth}
        onChange={setCoverWidth}
        validate={isValidCoverDimension}
      />
      <NumberInput
        name="coverHeight"
        label="Cover height"
        value={coverHeight}
        onChange={setCoverHeight}
        validate={isValidCoverDimension}
      />
      <Select
        name="coverFit"
        label="Cover fit"
        value={coverFit}
        options={COVER_FIT_OPTIONS}
        onChange={setCoverFit}
        searchable={false}
      />
      <Switch name="bwCover" label="Black & white cover" checked={bwCover} onChange={setBwCover} />
      <Switch
        name="simplify"
        label="Simplify Book"
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
