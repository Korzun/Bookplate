import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api-fetch');

import { apiFetch } from '~/lib/api-fetch';
import { renderWithProviders } from '~/test-utils';

import { Cover } from './index';

const mockApiFetch = vi.mocked(apiFetch);

const defaultProps = {
  sequence: 1 as const,
  width: 100,
  height: 150,
};

const makeOkResponse = (blob: Blob) => ({
  ok: true,
  blob: () => Promise.resolve(blob),
});

const createObjectURL = vi.fn(() => 'blob:test-cover');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  mockApiFetch.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:test-cover');
  revokeObjectURL.mockReset();
});

describe('Cover', () => {
  it('fetches the cover via apiFetch and renders an img with the blob URL', async () => {
    const blob = new Blob(['img-bytes'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { getByRole } = renderWithProviders(
      <Cover bookId="book1" title="My Book" {...defaultProps} />
    );

    await waitFor(() => {
      expect(getByRole('img')).toHaveAttribute('src', 'blob:test-cover');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book1/cover');
  });

  it('appends ?width= when thumbnailWidth is given', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    renderWithProviders(<Cover bookId="book2" thumbnailWidth={170} {...defaultProps} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/books/book2/cover?width=170');
    });
  });

  it('renders a ghost div (no img) when bookId is null', () => {
    const { queryByRole } = renderWithProviders(<Cover bookId={null} {...defaultProps} />);
    expect(queryByRole('img')).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('revokes the blob URL on unmount', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' });
    createObjectURL.mockReturnValueOnce('blob:cover-to-revoke');
    mockApiFetch.mockResolvedValueOnce(makeOkResponse(blob) as Response);

    const { getByRole, unmount } = renderWithProviders(
      <Cover bookId="book3" title="Test Cover" {...defaultProps} />
    );

    await waitFor(() => expect(getByRole('img')).toHaveAttribute('src', 'blob:cover-to-revoke'));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-to-revoke');
  });
});
