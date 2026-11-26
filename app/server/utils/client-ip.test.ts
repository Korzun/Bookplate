import { isPrivateAddress } from './client-ip';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.3.4',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
    '::FFFF:192.168.0.1',
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '11.0.0.1',
    '2001:db8::1',
    'fec0::1',
    '::ffff:8.8.8.8',
    'unknown',
    '',
    'client-a',
  ])('%s is not private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});
