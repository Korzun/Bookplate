import { describe, expect, it } from 'vite-plus/test';

import { coverUrl } from './cover-url';

describe('coverUrl', () => {
  it('builds a bare cover URL with no params', () => {
    expect(coverUrl('book1')).toBe('/api/books/book1/cover');
  });

  it('includes the thumbnail width', () => {
    expect(coverUrl('book1', { width: 88 })).toBe('/api/books/book1/cover?width=88');
  });

  it('appends a numeric version token verbatim', () => {
    expect(coverUrl('book1', { width: 88, version: 1700000000123 })).toBe(
      '/api/books/book1/cover?width=88&v=1700000000123'
    );
  });

  it('converts an ISO timestamp version into epoch milliseconds', () => {
    expect(coverUrl('book1', { version: '2024-01-15T12:34:56.000Z' })).toBe(
      `/api/books/book1/cover?v=${Date.parse('2024-01-15T12:34:56.000Z')}`
    );
  });

  it('omits the version param when not provided', () => {
    expect(coverUrl('book1', { width: 160 })).not.toContain('v=');
  });

  it('encodes the book id', () => {
    expect(coverUrl('a/b')).toBe('/api/books/a%2Fb/cover');
  });
});
