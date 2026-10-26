import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { MetadataFix } from '~/lib/book-types';
import { renderWithProviders } from '~/test-utils';

import { EditFixModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

const flagged: MetadataFix = {
  field: 'title',
  kind: 'title-is-filename',
  from: 'book',
  to: null,
  reason: 'The title is the same as the file name.',
  changes: {},
};

const noop = {
  onSave: () => Promise.resolve(true),
  onKeep: () => {},
  onClose: () => {},
};

const button = (name: string | RegExp) => screen.getByRole('button', { name, hidden: true });
const input = () => screen.getByRole('textbox', { hidden: true });

describe('EditFixModal', () => {
  it('shows the field label, the reason, and the current value in the input', () => {
    const { container } = renderWithProviders(<EditFixModal isOpen fix={flagged} {...noop} />);
    expect(container.textContent).toContain('Fix Title');
    expect(container.textContent).toContain('The title is the same as the file name.');
    expect(input()).toHaveValue('book');
  });

  it('offers "Keep as is" while the value is unchanged, and "Save" once it differs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditFixModal isOpen fix={flagged} {...noop} />);
    expect(button('Keep as is')).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByRole('button', { name: 'Save', hidden: true })).toBeNull();

    await user.type(input(), '!');
    expect(button('Save')).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByRole('button', { name: 'Keep as is', hidden: true })).toBeNull();

    // Whitespace-only differences still count as unchanged.
    await user.clear(input());
    await user.type(input(), '  book  ');
    expect(button('Keep as is')).toBeInTheDocument();
  });

  it('disables the primary button while the value is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EditFixModal isOpen fix={flagged} {...noop} />);

    await user.clear(input());
    expect(button('Save')).toHaveAttribute('aria-disabled', 'true');

    await user.type(input(), '   ');
    expect(button('Save')).toHaveAttribute('aria-disabled', 'true');
  });

  it('saves the trimmed value and closes once onSave succeeds', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    renderWithProviders(
      <EditFixModal isOpen fix={flagged} {...noop} onSave={onSave} onClose={onClose} />
    );

    await user.clear(input());
    await user.type(input(), '  A Real Title  ');
    await user.click(button('Save'));

    expect(onSave).toHaveBeenCalledWith(flagged, 'A Real Title');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when onSave reports failure', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    renderWithProviders(
      <EditFixModal isOpen fix={flagged} {...noop} onSave={onSave} onClose={onClose} />
    );

    await user.clear(input());
    await user.type(input(), 'A Real Title');
    await user.click(button('Save'));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Keep as is" hands the flagged fix to onKeep and closes, without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onKeep = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditFixModal isOpen fix={flagged} onSave={onSave} onKeep={onKeep} onClose={onClose} />
    );

    await user.click(button('Keep as is'));

    expect(onKeep).toHaveBeenCalledWith(flagged);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Cancel closes without saving or keeping', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onKeep = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditFixModal isOpen fix={flagged} onSave={onSave} onKeep={onKeep} onClose={onClose} />
    );

    await user.click(button('Cancel'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when a text selection started in the input is released on the backdrop', () => {
    const onClose = vi.fn();
    renderWithProviders(<EditFixModal isOpen fix={flagged} {...noop} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { hidden: true });

    // A drag-select: the press lands in the input, the release lands on the
    // backdrop, and the browser fires the click on their common ancestor —
    // the <dialog> itself, exactly where a backdrop click would land.
    fireEvent.mouseDown(input());
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a click that both starts and ends on the backdrop', () => {
    const onClose = vi.fn();
    renderWithProviders(<EditFixModal isOpen fix={flagged} {...noop} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { hidden: true });

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
