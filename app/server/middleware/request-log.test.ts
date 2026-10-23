import { redactUrl } from './request-log';

vi.mock('../logger');

describe('redactUrl', () => {
  it('hides the ticket in an MCP transfer URL', () => {
    expect(redactUrl('/mcp/download/eyJhbGciOi.x.y')).toBe('/mcp/download/<ticket>');
    expect(redactUrl('/mcp/upload/eyJhbGciOi.x.y?foo=1')).toBe('/mcp/upload/<ticket>?foo=1');
  });

  it('leaves every other URL alone', () => {
    for (const url of ['/mcp', '/api/books/abc/download', '/opds/download/x', '/']) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});
