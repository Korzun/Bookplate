import { describe, expect, it, vi, beforeEach } from 'vitest';

import { stageUpload } from './staged-upload';

vi.mock('~/lib/api-fetch', () => ({ apiFetch: vi.fn() }));
const { apiFetch } = await import('~/lib/api-fetch');
const mockApiFetch = vi.mocked(apiFetch);

const file = new File(['bytes'], 'cover.jpg', { type: 'image/jpeg' });

describe('stageUpload', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('posts the file to the cover-staging route and returns the staged id', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ stagedUploadId: 'staged-1' }),
    } as Response);

    await expect(stageUpload(file, 'cover')).resolves.toBe('staged-1');

    const [url, init] = mockApiFetch.mock.calls[0];
    expect(url).toBe('/api/books/cover-staging');
    expect((init as RequestInit).method).toBe('POST');
    const body = (init as RequestInit).body as FormData;
    expect(body.get('cover')).toBe(file);
  });

  it('posts to the replace-staging route for an epub', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ stagedUploadId: 'staged-2' }),
    } as Response);

    await stageUpload(file, 'epub');

    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/books/replace-staging');
  });

  it('applies withTargetUser to the URL when given', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ stagedUploadId: 'staged-3' }),
    } as Response);

    await stageUpload(file, 'cover', (url) => `${url}?user=someone`);

    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/books/cover-staging?user=someone');
  });

  it('rejects with the server-supplied message on a non-ok response', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'No file uploaded' }),
    } as Response);

    await expect(stageUpload(file, 'cover')).rejects.toThrow('No file uploaded');
  });

  it('rejects with a generic message when the error body is not JSON', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(stageUpload(file, 'cover')).rejects.toThrow(/cover/i);
  });
});
