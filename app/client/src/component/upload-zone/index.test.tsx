import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { UploadZone } from './index';

describe('UploadZone', () => {
  it('defaults the drop copy to "books"', () => {
    const { container } = renderWithProviders(<UploadZone addFiles={vi.fn()} />);
    expect(container.textContent).toContain('Drop books here');
  });

  it('uses the provided dropLabel in the copy', () => {
    const { container } = renderWithProviders(
      <UploadZone addFiles={vi.fn()} dropLabel="replacement" />
    );
    expect(container.textContent).toContain('Drop replacement here');
    expect(container.textContent).not.toContain('Drop books here');
  });

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
