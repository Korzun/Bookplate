import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceProvider } from '~/provider/device';
import type { Device } from '~/provider/device';
import { renderWithProviders } from '~/test-utils';

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

function renderForm() {
  const rendered = renderWithProviders(
    <DeviceProvider>
      <DeviceForm />
    </DeviceProvider>
  );
  const nameInput = rendered.container.querySelector('input[name="name"]') as HTMLInputElement;
  return { ...rendered, nameInput };
}

describe('DeviceForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caps the committed name at 50 characters', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) });
    vi.stubGlobal('fetch', fetchMock);

    const { nameInput } = renderForm();
    // 51 characters: typing is blocked past the 50-char limit, so the committed
    // name used for submission stays at the last valid 50-char prefix.
    await user.type(nameInput, 'a'.repeat(51));
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { name: string };
    expect(body.name).toBe('a'.repeat(50));
  });

  it('submits the parsed DeviceInput, with empty cover dimensions sent as null', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) });
    vi.stubGlobal('fetch', fetchMock);

    const { nameInput } = renderForm();
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kindle',
        coverWidth: null,
        coverHeight: null,
        coverFit: 'contain',
        bwCover: false,
        simplify: false,
      }),
    });
  });

  it('resets the form and shows a success toast after creating a device', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) })
    );

    const { nameInput } = renderForm();
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toMatch(/created/i);
    expect(nameInput.value).toBe('');
  });

  it('shows an error toast when creation fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Server error')));

    const { nameInput } = renderForm();
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('Server error');
  });

  it('surfaces the server-specific 400 message instead of a generic toast', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ error: 'coverWidth must be a positive integer' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { nameInput } = renderForm();
    await user.type(nameInput, 'Kindle');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    const toast = await screen.findByRole('status');
    expect(toast.textContent).toBe('coverWidth must be a positive integer');
  });

  it.each(['-5', '0', '3.5'])(
    'does not commit a non-positive/non-integer coverWidth (%s) to the create call',
    async (badValue) => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) });
      vi.stubGlobal('fetch', fetchMock);

      const { container, nameInput } = renderForm();
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
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as { coverWidth: number | null };
      expect(body.coverWidth).toBe(null);
    }
  );

  it('accepts a positive integer coverWidth and submits it as-is', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 201, json: () => Promise.resolve(kindle) });
    vi.stubGlobal('fetch', fetchMock);

    const { container, nameInput } = renderForm();
    const coverWidthInput = container.querySelector('input[name="coverWidth"]') as HTMLInputElement;

    await user.type(nameInput, 'Kindle');
    await user.type(coverWidthInput, '600');
    expect(coverWidthInput.value).toBe('600');
    await user.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { coverWidth: number | null };
    expect(body.coverWidth).toBe(600);
  });

  it('pre-fills the form and shows a Save button when editing an existing device', () => {
    const { container } = renderWithProviders(
      <DeviceProvider>
        <DeviceForm device={kindle} onDone={() => {}} />
      </DeviceProvider>
    );
    const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Kindle');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Create-only affordance is absent in edit mode.
    expect(screen.queryByRole('button', { name: /add device/i })).not.toBeInTheDocument();
  });

  it('saves edits via PATCH /api/devices/:id and calls onDone', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, json: () => Promise.resolve(kindle) });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <DeviceProvider>
        <DeviceForm device={kindle} onDone={onDone} />
      </DeviceProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/devices/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kindle',
        coverWidth: null,
        coverHeight: null,
        coverFit: 'contain',
        bwCover: false,
        simplify: false,
      }),
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('calls onDone without saving when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <DeviceProvider>
        <DeviceForm device={kindle} onDone={onDone} />
      </DeviceProvider>
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onDone).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
