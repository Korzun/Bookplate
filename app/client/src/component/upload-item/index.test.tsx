import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { UploadItem as UploadItemType } from '~/provider/book';
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

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('UploadItem', () => {
  it('shows filename', () => {
    renderWithProviders(<UploadItem item={makeItem({ file: new File([''], 'dune.epub') })} />);
    expect(screen.getByText('dune.epub')).toBeTruthy();
  });

  it('queued: shows total MB and no error border', () => {
    renderWithProviders(<UploadItem item={makeItem({ status: 'queued' })} />);
    expect(screen.getByText('1.0 MB')).toBeTruthy();
  });

  it('uploading: shows uploaded/total MB', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'uploading', bytesUploaded: 524_288 })} />
    );
    expect(screen.getByText('0.5 / 1.0 MB')).toBeTruthy();
  });

  it('done: shows full MB label', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'done', bytesUploaded: 1_048_576 })} />
    );
    expect(screen.getByText('1.0 / 1.0 MB')).toBeTruthy();
  });

  it('error: shows error message', () => {
    renderWithProviders(
      <UploadItem item={makeItem({ status: 'error', errorMessage: 'Invalid EPUB' })} />
    );
    expect(screen.getByText('Invalid EPUB')).toBeTruthy();
  });

  it('error: shows fallback text when no errorMessage', () => {
    renderWithProviders(<UploadItem item={makeItem({ status: 'error' })} />);
    expect(screen.getByText('Upload failed')).toBeTruthy();
  });

  it('validation error: shows severity counts and a View details button', () => {
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
      />
    );
    expect(screen.getByText('1 Fatal')).toBeTruthy();
    expect(screen.getByText('1 Error')).toBeTruthy();
    expect(screen.getByText('2 Warning')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy();
  });

  it('non-validation error: shows the plain message and no View details button', () => {
    renderWithProviders(
      <UploadItem
        item={makeItem({ status: 'error', errorMessage: 'Failed to parse EPUB: boom' })}
      />
    );
    expect(screen.getByText('Failed to parse EPUB: boom')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View details' })).toBeNull();
  });

  it('opens the details modal when View details is clicked', () => {
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
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByText('unreadable')).toBeTruthy();
  });
});
