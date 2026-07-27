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

let validateReplacement = vi.fn();
let commitReplacement = vi.fn();
let validating = false;
let committing = false;

vi.mock('~/provider/book', () => ({
  useReplaceBook: () => ({
    validateReplacement,
    commitReplacement,
    validating,
    committing,
  }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  validateReplacement = vi.fn();
  commitReplacement = vi.fn();
  validating = false;
  committing = false;
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
    validateReplacement.mockResolvedValue(report);

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

    expect(validateReplacement).toHaveBeenCalledWith('b1', file);
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
    validateReplacement.mockResolvedValue(report);

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
    validateReplacement.mockResolvedValue(report);
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

    expect(commitReplacement).toHaveBeenCalledWith('b1', file);
    expect(onReplaced).toHaveBeenCalledWith('b2');
  });
});
