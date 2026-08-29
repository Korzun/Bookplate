import type { Reference } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useActionState, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Card, CardDivider } from '~/component';
import { UserRowFragment } from '~/component/user-row';
import { Button, ChipsInput, NumberInput, Select, Switch, TextInput } from '~/control';
import type { SelectOption } from '~/control';
import { useFragment } from '~/gql';
import type {
  CoverFit,
  DeviceCreateMutation,
  DeviceDisableUserMutation,
  DeviceEnableUserMutation,
  DeviceUpdateMutation,
} from '~/gql/graphql';
import {
  DeviceCreateDocument,
  DeviceDisableUserDocument,
  DeviceEnableUserDocument,
  DeviceUpdateDocument,
  DeviceUsersDocument,
} from '~/graphql/device';
import { UserListDocument } from '~/graphql/user';
import { unwrapResult } from '~/provider/apollo';
import { useIsAdmin } from '~/provider/auth';
import { useToast } from '~/provider/toast';
import { isNumeric } from '~/utils';

import { coverFitToGraphQL } from '../device-row/cover-fit';
import { useStyle } from './style';

const NAME_MAX_LENGTH = 50;

// Empty (cleared to "auto") or a positive integer, matching the server's
// `coverWidth/coverHeight must be a positive integer` zod rules in
// app/server/graphql/schema/device/mutation/device-fields-schema.ts.
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

// The inverse of `coverFitToGraphQL` (`./cover-fit.ts`), needed only here:
// pre-filling the (lowercase) Select from an existing device's SCREAMING_CASE
// `coverFit`. An exhaustive `Record`, not a `.toLowerCase()` cast, for the
// same reason `cover-fit.ts`'s own two maps are — a cast would silently
// accept a future enum member this map does not yet know about.
const COVER_FIT_FROM_GRAPHQL: Record<CoverFit, 'contain' | 'cover' | 'fill' | 'smart'> = {
  CONTAIN: 'contain',
  COVER: 'cover',
  FILL: 'fill',
  SMART: 'smart',
};

// `unwrapResult`'s `TPayload` sits in a position TypeScript cannot infer from
// the call, so each is named explicitly here, extracted from the generated
// union rather than hand-duplicated — mirrors the REST-era provider hooks
// this component inlines.
type DeviceCreatePayload = Extract<
  DeviceCreateMutation['deviceCreate'],
  { __typename: 'DeviceCreatePayload' }
>;
type DeviceUpdatePayload = Extract<
  NonNullable<DeviceUpdateMutation['deviceUpdate']>,
  { __typename: 'DeviceUpdatePayload' }
>;
type DeviceEnableUserPayload = Extract<
  NonNullable<DeviceEnableUserMutation['deviceEnableUser']>,
  { __typename: 'DeviceEnableUserPayload' }
>;
type DeviceDisableUserPayload = Extract<
  NonNullable<DeviceDisableUserMutation['deviceDisableUser']>,
  { __typename: 'DeviceDisableUserPayload' }
>;

// A stable identity across renders, not a fresh `[]` literal — this
// component derives its pending selection from `fetchedUsers` on every
// render (`selectedUsers = editedUsers ?? fetchedUsers`) rather than syncing
// it into state via an effect, specifically to dodge a set-state-in-effect
// render loop a fresh array identity here would otherwise cause.
const EMPTY_USERS: string[] = [];

// The shape `DeviceRow` hands down when editing — its own `DeviceRowFragment`
// unmasked, field for field. Declared locally (rather than imported off
// `component/device-row`) so this component states what it needs on its own
// terms; TypeScript's structural typing accepts `DeviceRow`'s unmasked
// fragment value here without either component depending on the other's
// exact type name.
type DeviceFormDevice = {
  id: string;
  name: string;
  slug: string;
  coverWidth: number | null;
  coverHeight: number | null;
  coverFit: CoverFit;
  bwCover: boolean;
  simplify: boolean;
};

type DeviceFormProps = {
  // When provided, the form edits this existing device; otherwise it creates one.
  device?: DeviceFormDevice;
  // Called after a successful edit save, or when editing is cancelled.
  onDone?: () => void;
};

/**
 * `useCreateDevice`/`useUpdateDevice`/`useDeviceUsers`/`useEnableDeviceUser`/
 * `useDisableDeviceUser` are inlined directly here rather than kept as
 * `provider/device` hooks — this form is their only caller, matching
 * `control/unlink-book-lineage-button`'s precedent for a single-consumer
 * mutation. The admin user list (`UserListDocument`, imported from the leaf
 * module `~/graphql/user` rather than duplicated) is read the SAME way: no
 * dedicated `provider/user` hook survives this task, so this component
 * queries the document directly and unmasks `component/user-row`'s
 * colocated `UserRowFragment` itself — this form is not a "row" for that
 * fragment, but it needs the exact same `id`/`username` pair every row does,
 * to resolve chip labels against `User` global ids.
 *
 * `useDeviceUsers`'s two pinned behaviours survive the move verbatim:
 * `skip: !isAdmin` stops the `DeviceUsers` request before the server can
 * deny it (`Device.enabledUsers` is admin-only, and Apollo's default
 * `errorPolicy: 'none'` would otherwise discard `data` entirely on that
 * denial — there is deliberately no "null folds to empty" branch here), and
 * `loadingUsers` below reflects BOTH the `DeviceUsers` query and this
 * component's OWN `UserList` read (`allUsersLoading`) — folding only the
 * former would report an authoritative-looking empty list for a device that
 * does have enabled users while usernames are still being resolved. Same
 * reasoning for `UserListDocument`'s own `skip: !isAdmin` — it is admin-only
 * and nullable for the identical reason `DeviceUsersDocument` is; see
 * `UserListDocument`'s own doc comment (`~/graphql/user`).
 */
export const DeviceForm = ({ device, onDone }: DeviceFormProps) => {
  const styles = useStyle();
  const showToast = useToast();
  const isEdit = device !== undefined;
  // Unique per instance: device-form is co-mounted (an always-present create
  // form plus an edit form per editing row), so a static id would collide and
  // the footer-slot Save button's form="..." would resolve to the first match.
  const formId = useId();

  const [runCreate] = useMutation(DeviceCreateDocument);
  const [runUpdate] = useMutation(DeviceUpdateDocument);
  const [runEnableUser] = useMutation(DeviceEnableUserDocument);
  const [runDisableUser] = useMutation(DeviceDisableUserDocument);

  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const lastErrorRef = useRef<boolean>(false);

  const [isAdmin] = useIsAdmin();
  const { data: userListData, loading: allUsersLoading } = useQuery(UserListDocument, {
    skip: !isAdmin,
  });
  const unmaskedAllUsers = useFragment(UserRowFragment, userListData?.viewer.users ?? []);
  const allUsers = useMemo(
    () => unmaskedAllUsers.map((u) => ({ id: u.id, username: u.username })),
    [unmaskedAllUsers]
  );
  const userOptions = allUsers.map((u) => u.username);

  // Non-admins can still open the edit form (Edit isn't gated), and
  // `Device.enabledUsers` is admin-only server-side, so this query is
  // skipped outright for a non-admin rather than left dependent on a caller
  // passing an unusable id.
  const skipDeviceUsers = !isAdmin || device === undefined;
  const {
    data: deviceUsersData,
    loading: deviceUsersLoading,
    error: deviceUsersError,
  } = useQuery(DeviceUsersDocument, { skip: skipDeviceUsers });

  const [fetchedUsers, loadingUsers] = useMemo((): [string[], boolean] => {
    if (skipDeviceUsers || deviceUsersError !== undefined) {
      return [EMPTY_USERS, false];
    }
    // See this component's own doc comment: DeviceUsers resolving before
    // UserList must still report loading, not an authoritative empty list.
    if (deviceUsersLoading || allUsersLoading) {
      return [EMPTY_USERS, true];
    }

    const matchingDevice = deviceUsersData?.viewer.devices.find(
      (candidate) => candidate.id === device?.id
    );
    const enabledIds = new Set(
      (matchingDevice?.enabledUsers ?? []).map((enabledUser) => enabledUser.id)
    );
    const usernames = allUsers
      .filter((candidate) => enabledIds.has(candidate.id))
      .map((candidate) => candidate.username);
    return [usernames, false];
  }, [
    skipDeviceUsers,
    deviceUsersError,
    deviceUsersLoading,
    allUsersLoading,
    deviceUsersData,
    device?.id,
    allUsers,
  ]);

  // The Users chips field shows fetchedUsers (server truth) until the admin
  // edits it; editedUsers then takes over as the pending selection until Save
  // reconciles it back to the server and this resets to null. Deriving this
  // way (rather than syncing fetchedUsers into state via useEffect) avoids a
  // set-state-in-effect render loop, since fetchedUsers is a fresh []
  // literal (EMPTY_USERS aside) on every render while loading.
  const [editedUsers, setEditedUsers] = useState<string[] | null>(null);
  const selectedUsers = editedUsers ?? fetchedUsers;

  const [name, setName] = useState<string>(device?.name ?? '');
  const [coverWidth, setCoverWidth] = useState<number | undefined>(device?.coverWidth ?? undefined);
  const [coverHeight, setCoverHeight] = useState<number | undefined>(
    device?.coverHeight ?? undefined
  );
  const [coverFit, setCoverFit] = useState<string | undefined>(
    device ? COVER_FIT_FROM_GRAPHQL[device.coverFit] : 'contain'
  );
  const [bwCover, setBwCover] = useState<boolean>(device?.bwCover ?? false);
  const [simplify, setSimplify] = useState<boolean>(device?.simplify ?? false);

  const handleNameChange = useCallback((newValue: string | undefined) => {
    setName(newValue ?? '');
  }, []);

  // `deviceEnableUser`/`deviceDisableUser` take a `User` global id, not a
  // username — resolved against this component's own `UserListDocument`
  // read (`allUsers`, above) rather than a lookup query of its own. Both
  // return `device { id enabledUsers {
  // id } }`, which normalizes over the existing `Device:<id>` entity, so
  // neither needs an `update` function: the next `DeviceUsers` cache read
  // picks up the change for free.
  const enableUser = useCallback(
    async (deviceId: string, username: string): Promise<boolean> => {
      const user = allUsers.find((candidate) => candidate.username === username);
      if (!user) return false;
      try {
        const { data } = await runEnableUser({
          variables: { input: { deviceId, userId: user.id } },
        });
        const result = unwrapResult<DeviceEnableUserPayload>(
          data?.deviceEnableUser,
          'DeviceEnableUserPayload'
        );
        return result.status === 'ok';
      } catch {
        return false;
      }
    },
    [runEnableUser, allUsers]
  );
  const disableUser = useCallback(
    async (deviceId: string, username: string): Promise<boolean> => {
      const user = allUsers.find((candidate) => candidate.username === username);
      if (!user) return false;
      try {
        const { data } = await runDisableUser({
          variables: { input: { deviceId, userId: user.id } },
        });
        const result = unwrapResult<DeviceDisableUserPayload>(
          data?.deviceDisableUser,
          'DeviceDisableUserPayload'
        );
        return result.status === 'ok';
      } catch {
        return false;
      }
    },
    [runDisableUser, allUsers]
  );

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

    setHasError(false);
    setErrorMessage(undefined);

    const input = {
      name: trimmedName,
      coverWidth: coverWidth ?? null,
      coverHeight: coverHeight ?? null,
      coverFit: coverFitToGraphQL(
        (coverFit ?? 'contain') as 'contain' | 'cover' | 'fill' | 'smart'
      ),
      bwCover,
      simplify,
    };

    if (isEdit) {
      try {
        const { data } = await runUpdate({
          variables: { input: { deviceId: device.id, ...input } },
        });
        const result = unwrapResult<DeviceUpdatePayload>(data?.deviceUpdate, 'DeviceUpdatePayload');
        if (result.status === 'missing') {
          setHasError(true);
          setErrorMessage('Failed to update device');
          return;
        }
        if (result.status === 'error') {
          setHasError(true);
          setErrorMessage(result.message);
          return;
        }

        const reconciled = await reconcileUsers(device.id);
        // Keep the form open on a partial user failure so the pending
        // selection survives and the admin can re-submit; the error toast
        // already fired.
        if (!reconciled) return;
        showToast(`Device "${result.payload.device.name}" updated`, 'success');
        onDone?.();
      } catch (err) {
        setHasError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update device');
      }
      return;
    }

    try {
      const { data } = await runCreate({
        variables: { input },
        // `deviceCreate` returns the created `Device`, but a returned entity
        // does not insert itself into any list: `Viewer.devices` is read
        // separately (`page/device-list`'s `DeviceListDocument`), so this
        // appends into it via `cache.modify` on the `Viewer` singleton.
        update: (cache, { data: mutationData }) => {
          const created = unwrapResult<DeviceCreatePayload>(
            mutationData?.deviceCreate,
            'DeviceCreatePayload'
          );
          if (created.status !== 'ok') return;

          cache.modify({
            id: cache.identify({ __typename: 'Viewer' }),
            fields: {
              devices: (existing: readonly Reference[] = [], { toReference }) => {
                const ref = toReference(created.payload.device);
                return ref ? [...existing, ref] : existing;
              },
            },
          });
        },
      });
      const result = unwrapResult<DeviceCreatePayload>(data?.deviceCreate, 'DeviceCreatePayload');
      if (result.status === 'missing') {
        setHasError(true);
        setErrorMessage('Failed to create device');
        return;
      }
      if (result.status === 'error') {
        setHasError(true);
        setErrorMessage(result.message);
        return;
      }

      const reconciled = await reconcileUsers(result.payload.device.id);
      if (reconciled) showToast(`Device "${result.payload.device.name}" created`, 'success');
      setName('');
      setCoverWidth(undefined);
      setCoverHeight(undefined);
      setCoverFit('contain');
      setBwCover(false);
      setSimplify(false);
      setEditedUsers(null);
    } catch (err) {
      setHasError(true);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create device');
    }
  }, [
    isEdit,
    device,
    runCreate,
    runUpdate,
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

  const [, submitAction, isPending] = useActionState(async () => {
    await handleSubmit();
    return null;
  }, null);

  // handleSubmit resets hasError/errorMessage at the start of every attempt,
  // so watching hasError's transition to true reliably fires once per failed
  // attempt (mirrors page/book-edit's errorMessage handling).
  useEffect(() => {
    if (hasError && !lastErrorRef.current) {
      showToast(errorMessage ?? `Failed to ${isEdit ? 'update' : 'create'} device`, 'error');
    }
    lastErrorRef.current = hasError;
  }, [hasError, errorMessage, isEdit, showToast]);

  const fields = (
    <form id={formId} action={submitAction} className={styles.container}>
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
        clearable={false}
      />
      <Switch
        name="bwCover"
        label="Grayscale"
        layout="horizontal"
        checked={bwCover}
        onChange={setBwCover}
        description="Convert cover to grayscale for monochrome screens."
      />
      <CardDivider>Content</CardDivider>
      <Switch
        name="simplify"
        label="Simplify markup"
        layout="horizontal"
        checked={simplify}
        onChange={setSimplify}
        description="Replaces quote tags and special character codes in the book with plain equivalents, so simpler e-readers (such as Crosspoint) render the text correctly. Enable it for devices that struggle with complex formatting."
      />
      {!isEdit && <CardDivider />}
      {!isEdit && (
        <Button
          submit
          type="primary"
          radius="card"
          loading={isPending}
          disabled={name.trim() === ''}
        >
          {isPending ? 'Adding…' : 'Add device'}
        </Button>
      )}
    </form>
  );

  // Create renders its action inline in the body; edit keeps Cancel/Save in the
  // card footer. In edit mode the card replaces the device row's view card.
  const footer = isEdit ? (
    <>
      <Button radius="card" type="text" disabled={isPending} onClick={onDone}>
        Cancel
      </Button>
      <Button
        submit
        form={formId}
        type="primary"
        radius="card"
        loading={isPending}
        disabled={name.trim() === ''}
      >
        {isPending ? 'Saving…' : 'Save'}
      </Button>
    </>
  ) : undefined;

  return (
    <Card
      className={isEdit ? styles.editing : undefined}
      title={isEdit ? device.name : 'Add new Device'}
      footer={footer}
    >
      {fields}
    </Card>
  );
};
