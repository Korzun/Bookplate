import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  intro?: React.ReactNode;
}) {
  const messages = overrides.messages ?? [];
  return renderWithProviders(
    <ValidationDetailModal
      isOpen
      filename="book.epub"
      counts={{ ...EMPTY_COUNTS, ...overrides.counts }}
      messages={messages}
      threshold={overrides.threshold ?? 'ERROR'}
      intro={overrides.intro}
      onClose={vi.fn()}
    />
  );
}

const counts = { FATAL: 1, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 };
const messages: ValidationMessage[] = [
  { id: 'PKG-003', severity: 'FATAL', message: 'unreadable' },
  {
    id: 'RSC-005',
    severity: 'ERROR',
    message: 'parse error',
    location: { path: 'OEBPS/ch1.xhtml' },
  },
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
    expect(screen.getByText('in')).toBeTruthy();
    expect(screen.getByText('OEBPS/ch1.xhtml')).toBeTruthy();
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
    expect(screen.getByText('at')).toBeInTheDocument();
    expect(screen.getByText('content.opf:12')).toBeInTheDocument();
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
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(screen.getByText('mimetype')).toBeInTheDocument();
  });
});

describe('ValidationDetailModal message subjects', () => {
  it('renders subject segments as monospaced <code> without quotes', () => {
    renderModal({
      messages: [
        {
          id: 'RSC-007',
          severity: 'ERROR',
          message: 'Referenced resource "text/001-ch1.xhtml#pg-11" could not be found.',
          segments: [
            { text: 'Referenced resource ' },
            { text: 'text/001-ch1.xhtml#pg-11', subject: true },
            { text: ' could not be found.' },
          ],
        },
      ],
      counts: { ERROR: 1 },
    });
    const subject = screen.getByText('text/001-ch1.xhtml#pg-11');
    expect(subject.tagName).toBe('CODE');
    // the quotes are dropped from the rendered output
    expect(screen.queryByText(/"text/)).not.toBeInTheDocument();
    expect(screen.getByText(/Referenced resource/)).toBeInTheDocument();
  });

  it('falls back to the raw message when segments are absent', () => {
    renderModal({
      messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
      counts: { FATAL: 1 },
    });
    expect(screen.getByText('unreadable')).toBeInTheDocument();
  });
});

describe('ValidationDetailModal severity grouping', () => {
  it('renders a labeled separator per non-empty severity, most severe first', () => {
    renderModal({
      messages: [
        { id: 'RSC-012', severity: 'ERROR', message: 'error one' },
        { id: 'PKG-003', severity: 'FATAL', message: 'fatal one' },
        { id: 'RSC-013', severity: 'ERROR', message: 'error two' },
      ],
      counts: { FATAL: 1, ERROR: 2 },
      threshold: 'ERROR',
    });
    const separators = screen.getAllByRole('separator', { hidden: true });
    const labels = separators.map((s) => s.textContent);
    // Fatal group precedes Error group; no Warning/Info/Usage separators
    expect(labels).toEqual(['Fatal', 'Error']);
    // messages appear under their groups
    expect(screen.getByText('fatal one')).toBeInTheDocument();
    expect(screen.getByText('error two')).toBeInTheDocument();
  });
});

describe('ValidationDetailModal blocking-by-default toggle', () => {
  const mixed: ValidationMessage[] = [
    { id: 'PKG-003', severity: 'FATAL', message: 'fatal blocking' },
    { id: 'CSS-999', severity: 'USAGE', message: 'usage non-blocking' },
  ];

  it('shows only blocking messages by default', () => {
    renderModal({ messages: mixed, counts: { FATAL: 1, USAGE: 1 }, threshold: 'ERROR' });
    expect(screen.getByText('fatal blocking')).toBeInTheDocument();
    expect(screen.queryByText('usage non-blocking')).not.toBeInTheDocument();
  });

  it('reveals all messages when the toggle is clicked', async () => {
    const user = userEvent.setup();
    renderModal({ messages: mixed, counts: { FATAL: 1, USAGE: 1 }, threshold: 'ERROR' });
    await user.click(screen.getByRole('button', { name: 'Show all messages', hidden: true }));
    expect(screen.getByText('usage non-blocking')).toBeInTheDocument();
    // the revealed non-blocking severity label is marked non-blocking
    const row = screen.getByText('CSS-999').closest('li');
    expect(row?.querySelector('[data-blocking]')).toHaveAttribute('data-blocking', 'false');
    // toggle flips its label
    expect(
      screen.getByRole('button', { name: 'Show blocking only', hidden: true })
    ).toBeInTheDocument();
  });

  it('hides the toggle when there are no non-blocking messages', () => {
    renderModal({
      messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'fatal blocking' }],
      counts: { FATAL: 1 },
      threshold: 'ERROR',
    });
    expect(
      screen.queryByRole('button', { name: /show all messages/i, hidden: true })
    ).not.toBeInTheDocument();
  });
});

describe('ValidationDetailModal empty state', () => {
  it('shows an empty success state when there are no messages', () => {
    renderModal({ messages: [], counts: {} });
    expect(screen.getByText(/no validation issues/i)).toBeInTheDocument();
  });
});

describe('ValidationDetailModal show-all default', () => {
  it('defaults to showing all messages when nothing is blocking', () => {
    renderModal({
      messages: [{ id: 'HTM-004', severity: 'WARNING', message: 'note' }],
      counts: { WARNING: 1 },
      threshold: 'ERROR',
    });
    // A non-blocking WARNING is visible without clicking "Show all"
    expect(screen.getByText('note')).toBeInTheDocument();
  });
});

describe('ValidationDetailModal custom intro', () => {
  it('renders a custom intro when provided', () => {
    renderModal({
      messages: [{ id: 'HTM-004', severity: 'WARNING', message: 'note' }],
      counts: { WARNING: 1 },
      threshold: 'ERROR',
      intro: <span>custom intro text</span>,
    });
    expect(screen.getByText('custom intro text')).toBeInTheDocument();
  });
});
