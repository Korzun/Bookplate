import { isPrivateHost, isPublicHttpsUrl } from './private-host';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'nas.local',
    'printer.lan',
    'router.home.arpa',
    'svc.internal',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.1.1',
    '127.0.0.1',
    '0.0.0.0',
    '[::1]',
    '::',
    '::ffff:c0a8:101',
    'fd00::1',
    'fe80::1',
    'homeassistant',
  ])('treats %s as private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['books.example.com', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '[2606:4700::1111]'])(
    'treats %s as public',
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    }
  );
});

describe('isPublicHttpsUrl', () => {
  it('accepts a public https URL', () => {
    expect(isPublicHttpsUrl('https://1.1.1.1/x')).toBe(true);
    expect(isPublicHttpsUrl('https://push.example.com/endpoint')).toBe(true);
  });
  it('rejects http, private hosts and unparsable strings', () => {
    expect(isPublicHttpsUrl('http://push.example.com/endpoint')).toBe(false);
    expect(isPublicHttpsUrl('https://192.168.1.1/x')).toBe(false);
    expect(isPublicHttpsUrl('not a url')).toBe(false);
  });
});
