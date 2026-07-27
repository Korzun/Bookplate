import { act, fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidationReport } from '~/lib/severity';
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

let analyzeReplacement = vi.fn();
let commitReplacement = vi.fn();
let analyzing = false;
let committing = false;
let commitError: string | undefined = undefined;

vi.mock('~/provider/book', () => ({
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

  it('enables Confirm and shows the valid state after a valid report', async () => {
    const report = makeReport({ valid: true });
    analyzeReplacement.mockResolvedValue(report);

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
    expect(screen.getByText(/is valid/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).not.toHaveAttribute(
      'aria-disabled'
    );
  });

  it('keeps Confirm disabled and shows issues after an invalid report', async () => {
    const report = makeReport({
      valid: false,
      counts: { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
    });
    analyzeReplacement.mockResolvedValue(report);

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

    expect(screen.getByText(/failed validation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace', hidden: true })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('calls commitReplacement on confirm and fires onReplaced with the new id', async () => {
    const report = makeReport({ valid: true });
    analyzeReplacement.mockResolvedValue(report);
    commitReplacement.mockResolvedValue({ id: 'b2' });
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
    expect(onReplaced).toHaveBeenCalledWith('b2');
  });

  it('keeps the modal open, shows the commit error, and does not call onReplaced when commit fails', async () => {
    const report = makeReport({ valid: true });
    analyzeReplacement.mockResolvedValue(report);
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
    const report = makeReport({ valid: true });
    analyzeReplacement.mockResolvedValue(report);
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

  it('returns to the upload zone when choosing a different file after a valid preview', async () => {
    const report = makeReport({ valid: true });
    analyzeReplacement.mockResolvedValue(report);

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

    expect(document.getElementById('upload-file-input')).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Choose a different file', hidden: true })
      );
    });

    expect(document.getElementById('upload-file-input')).toBeTruthy();
  });

  it('shows a "couldn\'t validate" message and a way to pick another file when validation returns no report', async () => {
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
    expect(
      screen.getByRole('button', { name: 'Choose a different file', hidden: true })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Choose a different file', hidden: true })
      );
    });

    expect(document.getElementById('upload-file-input')).toBeTruthy();
  });
});
