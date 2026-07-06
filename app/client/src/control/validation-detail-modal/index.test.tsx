import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ValidationMessage } from '~/lib/severity';
import { renderWithProviders } from '~/test-utils';

import { ValidationDetailModal } from './index';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

const counts = { FATAL: 1, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 };
const messages: ValidationMessage[] = [
  { id: 'PKG-003', severity: 'FATAL', message: 'unreadable' },
  { id: 'RSC-005', severity: 'ERROR', message: 'parse error', location: 'OEBPS/ch1.xhtml' },
];

describe('ValidationDetailModal', () => {
  it('renders each blocking message with id, message and location', () => {
    renderWithProviders(
      <ValidationDetailModal
        isOpen
        filename="dune.epub"
        counts={counts}
        messages={messages}
        threshold="ERROR"
      />
    );
    expect(screen.getByText('dune.epub')).toBeTruthy();
    expect(screen.getByText('PKG-003')).toBeTruthy();
    expect(screen.getByText('unreadable')).toBeTruthy();
    expect(screen.getByText('RSC-005')).toBeTruthy();
    expect(screen.getByText('parse error')).toBeTruthy();
    expect(screen.getByText('at OEBPS/ch1.xhtml')).toBeTruthy();
  });

  it('names the active rejection threshold', () => {
    renderWithProviders(
      <ValidationDetailModal
        isOpen
        filename="dune.epub"
        counts={counts}
        messages={messages}
        threshold="WARNING"
      />
    );
    expect(screen.getByText(/reached the Warning rejection threshold/i)).toBeTruthy();
  });

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ValidationDetailModal
        isOpen
        filename="dune.epub"
        counts={counts}
        messages={messages}
        threshold="ERROR"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop (dialog) is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ValidationDetailModal
        isOpen
        filename="dune.epub"
        counts={counts}
        messages={messages}
        threshold="ERROR"
        onClose={onClose}
      />
    );
    const dialogElement = screen.getByRole('dialog', { hidden: true });
    fireEvent.click(dialogElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when inner content is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ValidationDetailModal
        isOpen
        filename="dune.epub"
        counts={counts}
        messages={messages}
        threshold="ERROR"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('dune.epub'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
