import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeviceCreateMutationVariables, DeviceUpdateMutationVariables } from '~/gql/graphql';
import { DeviceCreateDocument, DeviceUpdateDocument } from '~/graphql/device';
import type { Device } from '~/provider/device';
import { renderWithApollo } from '~/test-utils';

import { DeviceForm } from './index';

const kindle: Device = {
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'contain',
  bwCover: false,
  simplify: false,
};

const kindleDeviceGraphQL = {
  __typename: 'Device' as const,
  id: 'd1',
  name: 'Kindle',
  slug: 'kindle',
  coverWidth: null,
  coverHeight: null,
  coverFit: 'CONTAIN' as const,
  bwCover: false,
  simplify: false,
};

/** Records the exact variables a mutation was sent with, while still
 * matching (and thus resolving) the request — MockLink throws on an
 * unmatched request, so a test's assertion never silently passes against a
 * mock that was never hit. */
const captureVariables = <TVariables,>() => {
  const capture: { current?: TVariables } = {};
  const matcher = (vars: TVariables) => {
    capture.current = vars;
    return true;
  };
  return { capture, matcher };
};

const createSuccessMock = (matcher: (vars: DeviceCreateMutationVariables) => boolean) => ({
  request: { query: DeviceCreateDocument, variables: matcher },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceCreate: { __typename: 'DeviceCreatePayload' as const, device: kindleDeviceGraphQL },
    },
  },
});

const createErrorMock = (error: Error) => ({
  request: { query: DeviceCreateDocument, variables: () => true },
  error,
});

const createInvalidInputMock = (message: string) => ({
  request: { query: DeviceCreateDocument, variables: () => true },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceCreate: { __typename: 'InvalidInputError' as const, message },
    },
  },
});

const updateSuccessMock = (matcher: (vars: DeviceUpdateMutationVariables) => boolean) => ({
  request: { query: DeviceUpdateDocument, variables: matcher },
  result: {
    data: {
      __typename: 'Mutation' as const,
      deviceUpdate: { __typename: 'DeviceUpdatePayload' as const, device: kindleDeviceGraphQL },
    },
  },
});

// useDeviceUsers/useEnableDeviceUser/useDisableDeviceUser are mocked so the
// Users field's fetched baseline and reconciliation calls are directly
// assertable; useCreateDevice/useUpdateDevice keep their real implementation,
// exercised here against GraphQL mocks (see the `*Mock` builders above), so
// the existing form-behavior tests below are unaffected by task 3's rewire.
let mockDeviceUsers: [string[], boolean, boolean, string | undefined] = [
  [],
  false,
  false,
  undefined,
];
const enableUser = vi.fn().mockResolvedValue(true);
const disableUser = vi.fn().mockResolvedValue(true);

vi.mock('~/provider/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/device')>();
  return {
    ...actual,
    useDeviceUsers: () => mockDeviceUsers,
    useEnableDeviceUser: () => [enableUser, false, false, undefined],
    useDisableDeviceUser: () => [disableUser, false, false, undefined],
  };
});

vi.mock('~/provider/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/provider/user')>();
  return {
    ...actual,
    useUserList: () => [
      [
        { username: 'alice', progressCount: 0 },
        { username: 'bob', progressCount: 0 },
      ],
      false,
      false,
      undefined,
    ],
  };
});

type RenderFormOptions = Parameters<typeof renderWithApollo>[1];

function renderForm(device?: Device, onDone?: () => void, options?: RenderFormOptions) {
  const rendered = renderWithApollo(<DeviceForm device={device} onDone={onDone} />, options);
  const nameInput = rendered.container.querySelector('input[name="name"]') as HTMLInputElement;
  return { ...rendered, nameInput };
}

describe('DeviceForm', () => {
  afterEach(() => {
    mockDeviceUsers = [[], false, false, undefined];
    enableUser.mockClear();
    disableUser.mockClear();
  });

  it('caps the committed name at 50 characters', async () => {
    const user = userEvent.setup();
    const { capture, matcher } = captureVariables<DeviceCreateMutationVariables>();

    const { nameInput } = renderForm(undefined, undefined, {
      mocks: [createSuccessMock(matcher)],
    });
    // 51 characters: typing is blocked past the 50-char limit, so the committed
    // name used for submission stays at the last valid 50-char prefix.
    await user.type(nameInput, 'a'.repeat(51));
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(capture.current).toBeDefined());
    expect(capture.current?.input.name).toBe('a'.repeat(50));
  });

  it('submits the parsed DeviceInput, with empty cover dimensions sent as null', async () => {
    const user = userEvent.setup();
    const { capture, matcher } = captureVariables<DeviceCreateMutationVariables>();

    const { nameInput } = renderForm(undefined, undefined, {
      mocks: [createSuccessMock(matcher)],
    });
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(capture.current).toBeDefined());
    expect(capture.current?.input).toEqual({
      name: 'Kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'CONTAIN',
      bwCover: false,
      simplify: false,
    });
  });

  it('resets the form and shows a success toast after creating a device', async () => {
    const user = userEvent.setup();
    const { matcher } = captureVariables<DeviceCreateMutationVariables>();

    const { nameInput } = renderForm(undefined, undefined, {
      mocks: [createSuccessMock(matcher)],
    });
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toMatch(/created/i);
    expect(nameInput.value).toBe('');
  });

  it('shows an error toast when creation fails', async () => {
    const user = userEvent.setup();

    const { nameInput } = renderForm(undefined, undefined, {
      mocks: [createErrorMock(new Error('Server error'))],
    });
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('Server error');
  });

  it('surfaces the server-specific error message instead of a generic toast', async () => {
    const user = userEvent.setup();

    const { nameInput } = renderForm(undefined, undefined, {
      mocks: [createInvalidInputMock('coverWidth must be a positive integer')],
    });
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('coverWidth must be a positive integer');
  });

  it.each(['-5', '0', '3.5'])(
    'does not commit a non-positive/non-integer coverWidth (%s) to the create call',
    async (badValue) => {
      const user = userEvent.setup();
      const { capture, matcher } = captureVariables<DeviceCreateMutationVariables>();

      const { container, nameInput } = renderForm(undefined, undefined, {
        mocks: [createSuccessMock(matcher)],
      });
      const coverWidthInput = container.querySelector(
        'input[name="coverWidth"]'
      ) as HTMLInputElement;

      await user.type(nameInput, 'Kindle');
      // Paste the full value in one shot, so partially-typed intermediate
      // strings (e.g. "3." while typing "3.5") don't sneak past validate.
      await user.click(coverWidthInput);
      await user.paste(badValue);
      await user.click(screen.getByRole('button', { name: /add device/i }));

      // validate() rejects the value, so onChange never fires and the form's
      // coverWidth state stays undefined — the bad value is never sent.
      await waitFor(() => expect(capture.current).toBeDefined());
      expect(capture.current?.input.coverWidth).toBe(null);
    }
  );

  it('accepts a positive integer coverWidth and submits it as-is', async () => {
    const user = userEvent.setup();
    const { capture, matcher } = captureVariables<DeviceCreateMutationVariables>();

    const { container, nameInput } = renderForm(undefined, undefined, {
      mocks: [createSuccessMock(matcher)],
    });
    const coverWidthInput = container.querySelector('input[name="coverWidth"]') as HTMLInputElement;

    await user.type(nameInput, 'Kindle');
    await user.type(coverWidthInput, '600');
    expect(coverWidthInput.value).toBe('600');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(capture.current).toBeDefined());
    expect(capture.current?.input.coverWidth).toBe(600);
  });

  it('pre-fills the form and shows a Save button when editing an existing device', () => {
    const { container } = renderWithApollo(<DeviceForm device={kindle} onDone={() => {}} />);
    const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Kindle');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Create-only affordance is absent in edit mode.
    expect(screen.queryByRole('button', { name: /add device/i })).not.toBeInTheDocument();
  });

  it('saves edits via the DeviceUpdate mutation and calls onDone', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { capture, matcher } = captureVariables<DeviceUpdateMutationVariables>();

    renderWithApollo(<DeviceForm device={kindle} onDone={onDone} />, {
      mocks: [updateSuccessMock(matcher)],
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(capture.current).toBeDefined());
    expect(capture.current?.input).toEqual({
      deviceId: 'd1',
      name: 'Kindle',
      coverWidth: null,
      coverHeight: null,
      coverFit: 'CONTAIN',
      bwCover: false,
      simplify: false,
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('edit Save submits the edit form, not a co-mounted create form (id collision)', async () => {
    // Regression: DeviceListPage renders an always-present create <DeviceForm />
    // followed by an editing row's <DeviceForm device={...} />. With a static
    // id="device-form" both <form>s share the same id, so the edit Save button's
    // form="device-form" resolves to the FIRST match (the create form) and fires
    // the create action instead of updateDevice. A unique useId() id fixes it.
    const user = userEvent.setup();
    const onDone = vi.fn();
    const createCapture = captureVariables<DeviceCreateMutationVariables>();
    const updateCapture = captureVariables<DeviceUpdateMutationVariables>();

    const { container } = renderWithApollo(
      <>
        <DeviceForm />
        <DeviceForm device={kindle} onDone={onDone} />
      </>,
      {
        mocks: [updateSuccessMock(updateCapture.matcher), createSuccessMock(createCapture.matcher)],
      }
    );

    // Fill the create form's name so, if the collision fires, it would issue a
    // create mutation — making the wrong-form regression observable rather
    // than a silent early return on an empty name.
    const createNameInput = container.querySelectorAll('input[name="name"]')[0] as HTMLInputElement;
    await user.type(createNameInput, 'CreatedByMistake');

    // Only the edit instance renders a "Save" button (create renders "Add device").
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The edit Save must drive the edit form's DeviceUpdate mutation, never
    // the create form's DeviceCreate.
    await waitFor(() => expect(updateCapture.capture.current).toBeDefined());
    expect(updateCapture.capture.current?.input.deviceId).toBe('d1');
    expect(createCapture.capture.current).toBeUndefined();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('calls onDone without saving when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { capture, matcher } = captureVariables<DeviceUpdateMutationVariables>();

    renderWithApollo(<DeviceForm device={kindle} onDone={onDone} />, {
      mocks: [updateSuccessMock(matcher)],
    });
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onDone).toHaveBeenCalled();
    expect(capture.current).toBeUndefined();
  });

  describe('Users field', () => {
    it('is not rendered for a non-admin', () => {
      renderForm(kindle, () => {}, { user: { username: 'user', isAdmin: false } });
      expect(screen.queryByText('Users')).not.toBeInTheDocument();
    });

    it('creating a device with users selected enables them for the newly created device', async () => {
      const user = userEvent.setup();
      const { matcher } = captureVariables<DeviceCreateMutationVariables>();

      const { nameInput } = renderForm(undefined, undefined, {
        user: { username: 'admin', isAdmin: true },
        mocks: [createSuccessMock(matcher)],
      });
      await user.type(nameInput, 'Kindle');

      const usersInput = screen.getByLabelText('Users');
      await user.type(usersInput, 'alice');
      await user.click(screen.getByRole('option', { name: 'alice' }));
      await user.type(usersInput, 'bob');
      await user.click(screen.getByRole('option', { name: 'bob' }));
      expect(screen.getByLabelText('Remove alice')).toBeInTheDocument();
      expect(screen.getByLabelText('Remove bob')).toBeInTheDocument();

      // allowCustom is false, so a name that doesn't match a known user must
      // not be added even when Enter is pressed — and that stray Enter must not
      // submit the form (which would race the explicit "Add device" click below
      // by flipping its label to "Adding…").
      await user.type(usersInput, 'nonexistent{Enter}');
      expect(screen.queryByLabelText('Remove nonexistent')).not.toBeInTheDocument();
      expect(enableUser).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /add device/i }));

      await waitFor(() => expect(enableUser).toHaveBeenCalledWith('d1', 'alice'));
      await waitFor(() => expect(enableUser).toHaveBeenCalledWith('d1', 'bob'));
      expect(disableUser).not.toHaveBeenCalled();
    });

    it('editing pre-fills enabled users and reconciles added/removed users on Save', async () => {
      mockDeviceUsers = [['alice'], false, false, undefined];
      const user = userEvent.setup();
      const onDone = vi.fn();
      const { matcher } = captureVariables<DeviceUpdateMutationVariables>();

      renderForm(kindle, onDone, {
        user: { username: 'admin', isAdmin: true },
        mocks: [updateSuccessMock(matcher)],
      });

      // Pre-filled with the fetched 'alice' chip.
      expect(screen.getByLabelText('Remove alice')).toBeInTheDocument();

      // Type to filter and add 'bob'.
      const usersInput = screen.getByLabelText('Users');
      await user.type(usersInput, 'bob');
      await user.click(screen.getByRole('option', { name: 'bob' }));
      // Then remove the pre-filled 'alice'.
      await user.click(screen.getByLabelText('Remove alice'));

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(enableUser).toHaveBeenCalledWith('d1', 'bob'));
      await waitFor(() => expect(disableUser).toHaveBeenCalledWith('d1', 'alice'));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
    });

    it('keeps the edit form open when user reconciliation fails on Save', async () => {
      // A partial user-enable failure should not close the form: the pending
      // selection survives so the admin can re-submit.
      mockDeviceUsers = [['alice'], false, false, undefined];
      enableUser.mockResolvedValueOnce(false);
      const user = userEvent.setup();
      const onDone = vi.fn();
      const { matcher } = captureVariables<DeviceUpdateMutationVariables>();

      renderForm(kindle, onDone, {
        user: { username: 'admin', isAdmin: true },
        mocks: [updateSuccessMock(matcher)],
      });

      const usersInput = screen.getByLabelText('Users');
      await user.type(usersInput, 'bob');
      await user.click(screen.getByRole('option', { name: 'bob' }));

      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(enableUser).toHaveBeenCalledWith('d1', 'bob'));
      // Form stays open (Save still present) and the 'bob' selection is retained.
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByLabelText('Remove bob')).toBeInTheDocument();
      expect(onDone).not.toHaveBeenCalled();
    });

    it('keeps the Users field inert while enabled users are still loading', async () => {
      // Regression test: with the fetch in flight, fetchedUsers is still []
      // while loadingUsers is true. Before the fix, the field ignored the
      // loading flag, so an admin could interact with it during this window
      // and lock in a stale empty selection — clobbering the server's real
      // list on Save. Asserting the field is inert (shows "Loading…" and is
      // disabled) guards against that regression.
      mockDeviceUsers = [[], true, false, undefined];
      const user = userEvent.setup();

      renderForm(kindle, () => {}, { user: { username: 'admin', isAdmin: true } });

      const usersInput = screen.getByPlaceholderText('Loading…');
      expect(usersInput).toBeDisabled();
      await user.type(usersInput, 'alice');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
