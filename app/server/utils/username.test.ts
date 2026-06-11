import { isValidUsername, sanitizeUsername } from './username';

describe('isValidUsername', () => {
  it.each(['alice', 'Bob42', 'jane.doe', 'a', 'user_name', 'x-1'])('accepts %s', (name) => {
    expect(isValidUsername(name)).toBe(true);
  });

  it.each([
    '', // empty
    '.hidden', // leading dot (hidden folder / .staging collision)
    '-dash', // must start alphanumeric
    '_under', // must start alphanumeric
    'a/b', // path separator
    'a\\b', // path separator
    'a b', // space
    'ünïcode', // non-ASCII
    'semi;colon',
    '..',
  ])('rejects %j', (name) => {
    expect(isValidUsername(name)).toBe(false);
  });
});

describe('sanitizeUsername', () => {
  it('replaces invalid characters with dashes', () => {
    expect(sanitizeUsername('jane doe!')).toBe('jane-doe-');
  });

  it('strips leading non-alphanumerics', () => {
    expect(sanitizeUsername('.hidden')).toBe('hidden');
    expect(sanitizeUsername('--x')).toBe('x');
  });

  it('falls back to "user" when nothing survives', () => {
    expect(sanitizeUsername('!!!')).toBe('user');
    expect(sanitizeUsername('')).toBe('user');
  });

  it('produces valid usernames', () => {
    for (const input of ['.hidden', 'a/b', 'ünïcode', '!!!', 'jane doe']) {
      expect(isValidUsername(sanitizeUsername(input))).toBe(true);
    }
  });
});
