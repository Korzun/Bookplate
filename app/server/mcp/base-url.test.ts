import { resolveMcpBaseUrl } from './base-url';

describe('resolveMcpBaseUrl', () => {
  it('accepts an https origin and strips a trailing slash', () => {
    expect(resolveMcpBaseUrl('https://books.example/')?.href).toBe('https://books.example/');
    expect(resolveMcpBaseUrl('https://books.example')?.toString()).toBe('https://books.example/');
  });
  it('keeps http only for localhost', () => {
    expect(resolveMcpBaseUrl('http://localhost:5173')?.origin).toBe('http://localhost:5173');
    expect(resolveMcpBaseUrl('http://127.0.0.1:3000')?.origin).toBe('http://127.0.0.1:3000');
    expect(resolveMcpBaseUrl('http://192.168.1.5:3000')).toBeNull();
    expect(resolveMcpBaseUrl('http://books.example')).toBeNull();
  });
  it('is null when unset or unparsable', () => {
    expect(resolveMcpBaseUrl(undefined)).toBeNull();
    expect(resolveMcpBaseUrl(null)).toBeNull();
    expect(resolveMcpBaseUrl('')).toBeNull();
    expect(resolveMcpBaseUrl('not a url')).toBeNull();
  });
});
