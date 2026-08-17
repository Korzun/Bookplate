import { act, fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '~/lib/severity';
import { fixKey } from '~/provider/book';
import type { MetadataFix, ReplaceAnalysis } from '~/provider/book';
import { renderWithProviders } from '~/test-utils';

import { UploadReplaceModal } from './index';

function makeReport(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    valid: true,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    threshold: 'ERROR',
    ...overrides,
  };
}

function makeFix(overrides: Partial<MetadataFix> = {}): MetadataFix {
  return {
    field: 'title',
    kind: 'trim',
    from: ' Dune ',
    to: 'Dune',
    changes: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ReplaceAnalysis> = {}): ReplaceAnalysis {
  return {
    ...makeReport(),
    autoFixes: [],
    proposals: [],
    ...overrides,
  };
}

let analyzeReplacement = vi.fn();
let commitReplacement = vi.fn();
let analyzing = false;
let committing = false;
let commitError: string | undefined = undefined;

vi.mock('~/provider/book', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/provider/book')>()),
  useReplaceBook: () => ({
    analyzeReplacement,
    commitReplacement,
    analyzing,
    committing,
    commitError,
  }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  analyzeReplacement = vi.fn();
  commitReplacement = vi.fn();
  analyzing = false;
  committing = false;
  commitError = undefined;
});

function pickFile(file: File) {
  const input = document.getElementById('upload-file-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('UploadReplaceModal', () => {
  it('shows the upload zone until a file is picked', () => {
    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );
    expect(document.getElementById('upload-file-input')).toBeTruthy();
    expect(screen.getByText('Replace "Dune"')).toBeInTheDocument();
  });

  it('enables Confirm and shows the valid state after a valid analysis', async () => {
    const analysis = makeAnalysis({ valid: true });
    analyzeReplacement.mockResolvedValue(analysis);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(analyzeReplacement).toHaveBeenCalledWith('b1', file);
    // Filename hoisted to the top; a "Validation" divider precedes the valid line.
    expect(screen.getByText('replacement.epub')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText(/book is valid/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('keeps Confirm disabled and shows issues after an invalid analysis, with no FixReview', async () => {
    const analysis = makeAnalysis({
      valid: false,
      counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
      autoFixes: [makeFix()],
      proposals: [makeFix({ field: 'author', kind: 'typo', from: 'J. Doe', to: 'John Doe' })],
    });
    analyzeReplacement.mockResolvedValue(analysis);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'bad.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/book is not valid/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.queryByText('Automatic fixes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept', hidden: true })).not.toBeInTheDocument();
  });

  it('renders the FixReview with the auto fix and the actionable proposal for a valid analysis', async () => {
    const autoFix = makeFix();
    const proposal = makeFix({ field: 'author', kind: 'typo', from: 'J. Doe', to: 'John Doe' });
    const analysis = makeAnalysis({ valid: true, autoFixes: [autoFix], proposals: [proposal] });
    analyzeReplacement.mockResolvedValue(analysis);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Automatic fixes')).toBeInTheDocument();
    expect(screen.getByText('Suggested fixes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept', hidden: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject', hidden: true })).toBeInTheDocument();
  });

  it('accepting a proposal then confirming includes its key in acceptedFixKeys', async () => {
    const proposal = makeFix({ field: 'author', kind: 'typo', from: 'J. Doe', to: 'John Doe' });
    const analysis = makeAnalysis({ valid: true, autoFixes: [], proposals: [proposal] });
    analyzeReplacement.mockResolvedValue(analysis);
    commitReplacement.mockResolvedValue({ id: 'b2', globalId: 'gid-b2' });
    const onReplaced = vi.fn();

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={onReplaced}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept', hidden: true }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace', hidden: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitReplacement).toHaveBeenCalledWith('b1', file, [fixKey(proposal)]);
    expect(onReplaced).toHaveBeenCalledWith('gid-b2');
  });

  it('rejecting a proposal then confirming excludes its key from acceptedFixKeys', async () => {
    const proposal = makeFix({ field: 'author', kind: 'typo', from: 'J. Doe', to: 'John Doe' });
    const analysis = makeAnalysis({ valid: true, autoFixes: [], proposals: [proposal] });
    analyzeReplacement.mockResolvedValue(analysis);
    commitReplacement.mockResolvedValue({ id: 'b2', globalId: 'gid-b2' });

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject', hidden: true }));
    });

    expect(screen.queryByRole('button', { name: 'Accept', hidden: true })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace', hidden: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitReplacement).toHaveBeenCalledWith('b1', file, []);
  });

  it('keeps Replace disabled while an actionable suggested fix is unresolved, then enables it once resolved', async () => {
    const proposal = makeFix({ field: 'author', kind: 'typo', from: 'J. Doe', to: 'John Doe' });
    const analysis = makeAnalysis({ valid: true, proposals: [proposal] });
    analyzeReplacement.mockResolvedValue(analysis);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The EPUB is valid, but a suggested fix is still pending → Replace is blocked.
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    // Resolving the last actionable fix (here by rejecting it) unblocks Replace.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject', hidden: true }));
    });
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('does not block Replace on a flag-only "needs review" suggestion', async () => {
    const flagOnly = makeFix({
      field: 'subjects',
      kind: 'subjects-split',
      from: 'A / B',
      to: null,
    });
    const analysis = makeAnalysis({ valid: true, proposals: [flagOnly] });
    analyzeReplacement.mockResolvedValue(analysis);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    // A "needs review" item can't be accepted and has no per-row action here, so it
    // must not gate Replace — the button stays enabled.
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('leaving a proposal untouched excludes it from acceptedFixKeys on confirm', async () => {
    const report = makeAnalysis({ valid: true });
    analyzeReplacement.mockResolvedValue(report);
    commitReplacement.mockResolvedValue({ id: 'b2', globalId: 'gid-b2' });
    const onReplaced = vi.fn();

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={onReplaced}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace', hidden: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitReplacement).toHaveBeenCalledWith('b1', file, []);
    expect(onReplaced).toHaveBeenCalledWith('gid-b2');
  });

  it('keeps the modal open, shows the commit error, and does not call onReplaced when commit fails', async () => {
    const analysis = makeAnalysis({ valid: true });
    analyzeReplacement.mockResolvedValue(analysis);
    commitReplacement.mockResolvedValue(undefined);
    commitError = 'Fingerprint already exists on another book.';
    const onClose = vi.fn();
    const onReplaced = vi.fn();

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={onClose}
        onReplaced={onReplaced}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace', hidden: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReplaced).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Fingerprint already exists on another book.')).toBeInTheDocument();
  });

  it('shows a generic failure message when commit fails without an error body', async () => {
    const analysis = makeAnalysis({ valid: true });
    analyzeReplacement.mockResolvedValue(analysis);
    commitReplacement.mockResolvedValue(undefined);
    commitError = undefined;
    const onReplaced = vi.fn();

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={onReplaced}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Replace', hidden: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReplaced).not.toHaveBeenCalled();
    expect(screen.getByText('Replace failed.')).toBeInTheDocument();
  });

  it('shows a "couldn\'t validate" message when validation returns no report', async () => {
    analyzeReplacement.mockResolvedValue(undefined);

    renderWithProviders(
      <UploadReplaceModal
        isOpen
        bookId="b1"
        bookTitle="Dune"
        onClose={vi.fn()}
        onReplaced={vi.fn()}
      />
    );

    const file = new File(['x'.repeat(100)], 'replacement.epub');
    await act(async () => {
      pickFile(file);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/Couldn't validate/)).toBeInTheDocument();
    // No in-modal re-pick affordance — the user cancels to start over.
    expect(
      screen.queryByRole('button', { name: 'Choose a different file', hidden: true })
    ).not.toBeInTheDocument();
  });
});
