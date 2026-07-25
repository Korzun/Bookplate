import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Severity, ValidationMessage, ValidationThreshold } from '~/lib/severity';
import { renderWithProviders } from '~/test-utils';

import { ValidationDetailModal } from './index';

// jsdom does not implement <dialog> showModal/close — stub them.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

const EMPTY_COUNTS: Record<Severity, number> = {
  FATAL: 0,
  ERROR: 0,
  WARNING: 0,
  INFO: 0,
  USAGE: 0,
};

// Shared harness for this modal's tests. Extend the `overrides` shape here as later
// tasks need more control (e.g. filename, onClose spies) rather than duplicating props
// across every test.
function renderModal(overrides: {
  messages?: ValidationMessage[];
  counts?: Partial<Record<Severity, number>>;
  threshold?: ValidationThreshold;
}) {
  const messages = overrides.messages ?? [];
  return renderWithProviders(
    <ValidationDetailModal
      isOpen
      filename="book.epub"
      counts={{ ...EMPTY_COUNTS, ...overrides.counts }}
      messages={messages}
      threshold={overrides.threshold ?? 'ERROR'}
      onClose={vi.fn()}
    />
  );
}

const counts = { FATAL: 1, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 };
const messages: ValidationMessage[] = [
  { id: 'PKG-003', severity: 'FATAL', message: 'unreadable' },
  { id: 'RSC-005', severity: 'ERROR', message: 'parse error', location: { path: 'OEBPS/ch1.xhtml' } },
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
    expect(screen.getByText('in OEBPS/ch1.xhtml')).toBeTruthy();
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

describe('ValidationDetailModal subtitle', () => {
  it('renders the rejection copy with emphasized phrases', () => {
    renderModal({
      messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
      counts: { FATAL: 1 },
    });
    const danger = screen.getByText('rejection threshold');
    const strong = screen.getByText('must be fixed');
    expect(danger.tagName).toBe('STRONG');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.getByText(/before this EPUB can be uploaded\./)).toBeInTheDocument();
  });
});

describe('ValidationDetailModal location phrasing', () => {
  it('says "at path:line" when a line is present', () => {
    renderModal({
      messages: [
        {
          id: 'RSC-005',
          severity: 'ERROR',
          message: 'parse error',
          location: { path: 'content.opf', line: 12 },
        },
      ],
      counts: { ERROR: 1 },
    });
    expect(screen.getByText('at content.opf:12')).toBeInTheDocument();
  });

  it('says "in path" when only a path is present', () => {
    renderModal({
      messages: [
        {
          id: 'PKG-006',
          severity: 'FATAL',
          message: 'bad mimetype',
          location: { path: 'mimetype' },
        },
      ],
      counts: { FATAL: 1 },
    });
    expect(screen.getByText('in mimetype')).toBeInTheDocument();
  });
});
