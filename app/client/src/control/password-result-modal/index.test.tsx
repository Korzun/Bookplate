import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { PasswordResultModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('PasswordResultModal', () => {
  it('renders the username and password', () => {
    renderWithProviders(
      <PasswordResultModal isOpen username="alice" password="k4tWc9pLxQ2mAbCd" />
    );
    expect(screen.getByText(/alice/)).toBeInTheDocument();
    expect(screen.getByText('k4tWc9pLxQ2mAbCd')).toBeInTheDocument();
  });

  it('copies the password to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(
      <PasswordResultModal isOpen username="alice" password="k4tWc9pLxQ2mAbCd" />
    );

    await user.click(screen.getByRole('button', { name: 'Copy', hidden: true }));

    expect(writeText).toHaveBeenCalledWith('k4tWc9pLxQ2mAbCd');
    expect(screen.getByRole('button', { name: 'Copied!', hidden: true })).toBeInTheDocument();
  });

  it('calls onDone when the Done button is clicked', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithProviders(
      <PasswordResultModal isOpen username="alice" password="k4tWc9pLxQ2mAbCd" onDone={onDone} />
    );

    await user.click(screen.getByRole('button', { name: 'Done', hidden: true }));

    expect(onDone).toHaveBeenCalledOnce();
  });
});
