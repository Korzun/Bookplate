import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '~/provider/theme/provider';

import { UploadFixGuardModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

function setup() {
  const onReview = vi.fn();
  const onDismissAndEdit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ThemeProvider>
      <UploadFixGuardModal
        isOpen
        onReview={onReview}
        onDismissAndEdit={onDismissAndEdit}
        onCancel={onCancel}
      />
    </ThemeProvider>
  );
  return { onReview, onDismissAndEdit, onCancel };
}

describe('UploadFixGuardModal', () => {
  it('calls onReview when "Review fixes" is clicked', () => {
    const { onReview } = setup();
    fireEvent.click(screen.getByText('Review fixes'));
    expect(onReview).toHaveBeenCalledOnce();
  });
  it('calls onDismissAndEdit when "Dismiss fixes & edit" is clicked', () => {
    const { onDismissAndEdit } = setup();
    fireEvent.click(screen.getByText('Dismiss fixes & edit'));
    expect(onDismissAndEdit).toHaveBeenCalledOnce();
  });
  it('calls onCancel on backdrop click', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('dialog', { hidden: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
