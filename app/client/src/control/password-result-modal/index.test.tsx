import { act, fireEvent, screen } from '@testing-library/react';
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
    expect(screen.getByText((_, el) => el?.textContent === 'k4tWc9pLxQ2mAbCd')).toBeInTheDocument();
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

  it('completes the countdown immediately after a successful copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWithProviders(
      <PasswordResultModal isOpen username="alice" password="k4tWc9pLxQ2mAbCd" />
    );

    // Before copying, the countdown gates the Done button.
    expect(screen.getByRole('button', { name: 'Done (5)', hidden: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    await user.click(screen.getByRole('button', { name: 'Copy', hidden: true }));

    // Copying satisfies the countdown gate without waiting the full 5s, enabling Done.
    const done = screen.getByRole('button', { name: 'Done', hidden: true });
    expect(done).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('calls onDone when the Done button is clicked', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderWithProviders(
      <PasswordResultModal isOpen username="alice" password="k4tWc9pLxQ2mAbCd" onDone={onDone} />
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done', hidden: true }));

    expect(onDone).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
