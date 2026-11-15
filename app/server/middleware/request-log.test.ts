import { describe, expect, it } from 'vitest';

import { redactUploadToken } from './request-log';

describe('redactUploadToken', () => {
  it('replaces the token and keeps the query string', () => {
    expect(redactUploadToken('/mcp/uploads/abc?x=1')).toBe('/mcp/uploads/[redacted]?x=1');
  });

  it('replaces the token at the end of the path', () => {
    expect(redactUploadToken('/mcp/uploads/AbC-_123')).toBe('/mcp/uploads/[redacted]');
  });

  it('leaves other paths unchanged', () => {
    expect(redactUploadToken('/mcp')).toBe('/mcp');
    expect(redactUploadToken('/api/books?q=/mcp/x')).toBe('/api/books?q=/mcp/x');
  });
});
