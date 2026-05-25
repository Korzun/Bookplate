import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
