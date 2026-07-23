import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { MetadataFix, UploadItem as UploadItemType } from '~/provider/book';
import { renderWithProviders } from '~/test-utils';

import { UploadItem } from './index';

function makeItem(overrides: Partial<UploadItemType>): UploadItemType {
  return {
    id: '1',
    file: new File(['x'.repeat(1_048_576)], 'test.epub'), // 1 MB
    status: 'queued',
    bytesUploaded: 0,
    ...overrides,
  };
}

const noop = {
  onApplyFix: () => {},
  onApplyAll: () => {},
  onDismissAll: () => {},
  onUndo: () => {},
  onDismissFix: () => {},
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('UploadItem', () => {
  it('shows filename', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ file: new File([''], 'dune.epub') })} {...noop} />
    );
    expect(screen.getByText('dune.epub')).toBeTruthy();
  });

  it('queued: shows total MB and no error border', () => {
    renderWithProviders(<UploadItem item={makeItem({ status: 'queued' })} {...noop} />);
    expect(screen.getByText('1.0 MB')).toBeTruthy();
  });

  it('uploading: shows uploaded/total MB', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'uploading', bytesUploaded: 524_288 })} {...noop} />
    );
    expect(screen.getByText('0.5 / 1.0 MB')).toBeTruthy();
  });

  it('done: shows full MB label', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'done', bytesUploaded: 1_048_576 })} {...noop} />
    );
    expect(screen.getByText('1.0 / 1.0 MB')).toBeTruthy();
  });

  it('error: shows error message', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'error', errorMessage: 'Invalid EPUB' })} {...noop} />
    );
    expect(screen.getByText('Invalid EPUB')).toBeTruthy();
  });

  it('error: shows fallback text when no errorMessage', () => {
    renderWithProviders(<UploadItem item={makeItem({ status: 'error' })} {...noop} />);
    expect(screen.getByText('Upload failed')).toBeTruthy();
  });

  it('validation error: shows severity counts and a Details button', () => {
    renderWithProviders(
      <UploadItem
        item={makeItem({
          status: 'error',
          validation: {
            counts: { FATAL: 1, ERROR: 1, WARNING: 2, INFO: 0, USAGE: 0 },
            messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
            threshold: 'ERROR',
          },
        })}
        {...noop}
      />
    );
    expect(screen.getByText('1 Fatal')).toBeTruthy();
    expect(screen.getByText('1 Error')).toBeTruthy();
    expect(screen.getByText('2 Warning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy();
  });

  it('non-validation error: shows the plain message and no Details button', () => {
    renderWithProviders(
      <UploadItem
        item={makeItem({ status: 'error', errorMessage: 'Failed to parse EPUB: boom' })}
        {...noop}
      />
    );
    expect(screen.getByText('Failed to parse EPUB: boom')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  });

  it('opens the details modal when Details is clicked', () => {
    renderWithProviders(
      <UploadItem
        item={makeItem({
          status: 'error',
          validation: {
            counts: { FATAL: 1, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
            messages: [{ id: 'PKG-003', severity: 'FATAL', message: 'unreadable' }],
            threshold: 'ERROR',
          },
        })}
        {...noop}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('unreadable')).toBeTruthy();
  });
});

describe('UploadItem metadata fixes', () => {
  const appliedFixes: MetadataFix[] = [
    {
      field: 'titleSort',
      kind: 'title-sort-missing',
      from: '',
      to: 'Book, The',
      changes: { titleSort: 'Book, The' },
    },
  ];
  const proposals: MetadataFix[] = [
    {
      field: 'authorSort',
      kind: 'author-sort-missing',
      from: '',
      to: 'Guin, Ursula K. Le',
      changes: { authorSort: 'Guin, Ursula K. Le' },
    },
    {
      field: 'title',
      kind: 'title-is-filename',
      from: 'book',
      to: null,
      changes: {},
    },
  ];

  const doneItem = () =>
    makeItem({
      status: 'done',
      bytesUploaded: 1_048_576,
      bookId: 'abc',
      appliedFixes,
      proposals,
    });

  it('shows an applied "Fixed" note', () => {
    renderWithProviders(<UploadItem item={doneItem()} {...noop} />);
    expect(screen.getByText(/Book, The/)).toBeInTheDocument();
  });

  it('renders a proposal row with the proposed value and calls onApplyFix', () => {
    const onApplyFix = vi.fn();
    renderWithProviders(<UploadItem item={doneItem()} {...noop} onApplyFix={onApplyFix} />);
    expect(screen.getByText(/Guin, Ursula K\. Le/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApplyFix).toHaveBeenCalledWith(proposals[0]);
  });

  it('renders a subjects-split proposal as chips (compound -> parts)', () => {
    const subjectsFix: MetadataFix = {
      field: 'subjects',
      kind: 'subjects-split',
      from: 'Sci-Fi, Fantasy',
      to: 'Sci-Fi, Fantasy',
      changes: { subjects: ['Sci-Fi', 'Fantasy'] },
      fromChips: ['Sci-Fi, Fantasy'],
      toChips: ['Sci-Fi', 'Fantasy'],
    };
    renderWithProviders(
      <UploadItem
        item={makeItem({
          status: 'done',
          bytesUploaded: 1_048_576,
          bookId: 'abc',
          appliedFixes: [],
          proposals: [subjectsFix],
        })}
        {...noop}
      />
    );
    // The original compound is one chip; each split part is its own chip (no comma-join).
    expect(screen.getByText('Sci-Fi, Fantasy')).toBeInTheDocument();
    expect(screen.getByText('Sci-Fi')).toBeInTheDocument();
    expect(screen.getByText('Fantasy')).toBeInTheDocument();
    // Apply is still wired for the proposal.
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('calls onDismissFix when Dismiss is clicked', () => {
    const onDismissFix = vi.fn();
    renderWithProviders(<UploadItem item={doneItem()} {...noop} onDismissFix={onDismissFix} />);
    fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    expect(onDismissFix).toHaveBeenCalledWith(proposals[0]);
  });

  it('renders a flag-only row (no Apply) with an Edit link, and no Apply for it', () => {
    renderWithProviders(<UploadItem item={doneItem()} {...noop} />);
    // The title-is-filename proposal has to === null -> an Edit link to the book page.
    const editLink = screen.getByRole('link', { name: /edit/i });
    expect(editLink).toHaveAttribute('href', expect.stringContaining('abc'));
    // Only one actionable proposal -> only one Apply button (the flag-only row has none).
    expect(screen.getAllByRole('button', { name: /^apply$/i })).toHaveLength(1);
  });

  it('shows Apply all when there is more than one actionable proposal', () => {
    const onApplyAll = vi.fn();
    const twoActionable: MetadataFix[] = [
      ...proposals,
      {
        field: 'author',
        kind: 'author-missing',
        from: '',
        to: 'Ursula K. Le Guin',
        changes: { author: 'Ursula K. Le Guin' },
      },
    ];
    renderWithProviders(
      <UploadItem
        item={makeItem({
          status: 'done',
          bytesUploaded: 1_048_576,
          bookId: 'abc',
          appliedFixes: [],
          proposals: twoActionable,
        })}
        {...noop}
        onApplyAll={onApplyAll}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /apply all/i }));
    expect(onApplyAll).toHaveBeenCalled();
  });

  it('renders Apply all and a danger Dismiss all when proposals are present', () => {
    renderWithProviders(<UploadItem item={doneItem()} {...noop} />);
    expect(screen.getByRole('button', { name: /apply all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss all/i })).toBeInTheDocument();
  });

  it('renders only Undo when a snapshot is pending', () => {
    const item = makeItem({
      status: 'done',
      bytesUploaded: 1_048_576,
      bookId: 'abc',
      proposals: [],
      appliedFixes: [],
      undo: { kind: 'dismiss', proposals: [], appliedFixes: [] },
    });
    renderWithProviders(<UploadItem item={item} {...noop} />);
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss all/i })).not.toBeInTheDocument();
  });

  it('calls onDismissAll / onUndo', () => {
    const onDismissAll = vi.fn();
    renderWithProviders(<UploadItem item={doneItem()} {...noop} onDismissAll={onDismissAll} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss all/i }));
    expect(onDismissAll).toHaveBeenCalled();

    const onUndo = vi.fn();
    const undoItem = makeItem({
      status: 'done',
      bytesUploaded: 1_048_576,
      bookId: 'abc',
      proposals: [],
      undo: { kind: 'apply', proposals: [], appliedFixes: [] },
    });
    renderWithProviders(<UploadItem item={undoItem} {...noop} onUndo={onUndo} />);
    fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('disables Undo while its action is in flight and ignores a second click', async () => {
    let resolve!: () => void;
    const onUndo = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const undoItem = makeItem({
      status: 'done',
      bytesUploaded: 1_048_576,
      bookId: 'abc',
      proposals: [],
      undo: { kind: 'apply', proposals: [], appliedFixes: [] },
    });
    renderWithProviders(<UploadItem item={undoItem} {...noop} onUndo={onUndo} />);
    const undoBtn = screen.getByRole('button', { name: /^undo$/i });

    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
    // In flight → disabled; a second click is ignored.
    await waitFor(() => expect(undoBtn).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);

    // Once the action settles the button re-enables.
    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(undoBtn).not.toHaveAttribute('aria-disabled'));
  });

  it('does not render a metadata section when there are no fixes or proposals', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'done', bytesUploaded: 1_048_576 })} {...noop} />
    );
    expect(screen.queryByText(/Fixed/)).toBeNull();
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull();
  });

  it('renders a document (dcterms:modified) repair as a Fixed note', () => {
    renderWithProviders(
      <UploadItem
        item={makeItem({
          status: 'done',
          bytesUploaded: 1_048_576,
          bookId: 'abc',
          appliedFixes: [
            {
              field: 'document',
              kind: 'duplicate-modified-date',
              from: '',
              to: 'removed a duplicate modification date',
              changes: {},
            },
          ],
          proposals: [],
        })}
        {...noop}
      />
    );
    expect(screen.getByText(/removed a duplicate modification date/)).toBeInTheDocument();
    expect(screen.getByText(/EPUB/)).toBeInTheDocument();
  });
});
