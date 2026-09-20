import { describe, expect, it } from 'vitest';

import { passwordResetMessage, verificationMessage } from './mail-template';

const BASE = { to: 'reader@example.com', code: 'K7M2QX4P', libraryName: 'My Books' };

describe('verificationMessage', () => {
  it('always carries the code in both parts', () => {
    const message = verificationMessage({ ...BASE, publicUrl: null });
    expect(message.text).toContain('K7M2QX4P');
    expect(message.html).toContain('K7M2QX4P');
    expect(message.to).toBe('reader@example.com');
  });

  it('names the library in the subject so a reader with two instances can tell them apart', () => {
    expect(verificationMessage({ ...BASE, publicUrl: null }).subject).toContain('My Books');
  });

  it('omits any link when no public URL is configured', () => {
    const message = verificationMessage({ ...BASE, publicUrl: null });
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
  });

  it('includes a verify link carrying the code when a public URL is configured', () => {
    const message = verificationMessage({ ...BASE, publicUrl: 'https://books.example.com' });
    expect(message.text).toContain('https://books.example.com/set-email?code=K7M2QX4P');
    expect(message.html).toContain('href="https://books.example.com/set-email?code=K7M2QX4P"');
  });
});

describe('passwordResetMessage', () => {
  it('links to the reset page, not the verify page', () => {
    const message = passwordResetMessage({ ...BASE, publicUrl: 'https://books.example.com' });
    expect(message.text).toContain('https://books.example.com/reset-password?code=K7M2QX4P');
  });

  it('states that the code expires and that an unrequested mail can be ignored', () => {
    const message = passwordResetMessage({ ...BASE, publicUrl: null });
    expect(message.text.toLowerCase()).toContain('expire');
    expect(message.text.toLowerCase()).toContain("didn't request");
  });

  it('escapes the library name in the html part', () => {
    const message = passwordResetMessage({
      ...BASE,
      libraryName: '<script>x</script>',
      publicUrl: null,
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
