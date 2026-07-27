import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { UploadZone } from './index';

describe('UploadZone', () => {
  it('allows multiple files by default', () => {
    renderWithProviders(<UploadZone addFiles={vi.fn()} />);
    const input = document.getElementById('upload-file-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it('restricts to a single file when multiple={false}', () => {
    renderWithProviders(<UploadZone addFiles={vi.fn()} multiple={false} />);
    const input = document.getElementById('upload-file-input') as HTMLInputElement;
    expect(input.multiple).toBe(false);
  });

  it('still accepts multiple files when multiple is explicitly true', () => {
    renderWithProviders(<UploadZone addFiles={vi.fn()} multiple />);
    const input = document.getElementById('upload-file-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });
});
