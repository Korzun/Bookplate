// client/src/control/confirm-modal/index.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { renderWithProviders } from '~/test-utils';

import { ConfirmModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('ConfirmModal', () => {
  it('renders the title and children', () => {
    const { container } = renderWithProviders(
      <ConfirmModal isOpen title="Delete book">
        <p>Are you sure?</p>
      </ConfirmModal>
    );
    expect(container.textContent).toContain('Delete book');
    expect(container.textContent).toContain('Are you sure?');
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithProviders(<ConfirmModal isOpen onConfirm={onConfirm} confirmText="Yes, delete" />);
    await user.click(screen.getByRole('button', { name: 'Yes, delete', hidden: true }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<ConfirmModal isOpen onCancel={onCancel} cancelText="No, keep it" />);
    await user.click(screen.getByRole('button', { name: 'No, keep it', hidden: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders default button labels when no custom text is given', () => {
    renderWithProviders(<ConfirmModal isOpen />);
    expect(screen.getByRole('button', { name: 'Confirm', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel', hidden: true })).toBeInTheDocument();
  });
});
