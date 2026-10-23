import type { IncomingMessage } from 'http';

import { mcpResourceUrl, publicOrigin } from './public-origin';

const req = (headers: Record<string, string>, encrypted = false) =>
  ({ headers, socket: { encrypted } }) as unknown as IncomingMessage;

describe('publicOrigin', () => {
  it('prefers the configured public URL', () => {
    expect(publicOrigin(req({ host: 'evil.example' }), 'https://books.example.com')).toBe(
      'https://books.example.com'
    );
  });

  it("otherwise uses the request's own origin, honouring an HTTPS proxy", () => {
    expect(publicOrigin(req({ host: 'nas.local:3000' }), null)).toBe('http://nas.local:3000');
    expect(publicOrigin(req({ host: 'nas.local:3000' }, true), null)).toBe(
      'https://nas.local:3000'
    );
    expect(
      publicOrigin(req({ host: 'books.example.com', 'x-forwarded-proto': 'https, http' }), null)
    ).toBe('https://books.example.com');
    expect(publicOrigin(req({ host: 'h', 'x-forwarded-proto': 'gopher' }), null)).toBe('http://h');
  });

  it('names the MCP endpoint as the resource', () => {
    expect(mcpResourceUrl('https://books.example.com')).toBe('https://books.example.com/mcp');
  });
});
