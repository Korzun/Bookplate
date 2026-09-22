import { describe, expect, it } from 'vitest';

import {
  bookRequestedMessage,
  passwordResetMessage,
  requestDeclinedMessage,
  requestFulfilledMessage,
  verificationMessage,
} from './mail-template';

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

  it('escapes the library name in the html part', () => {
    const message = verificationMessage({
      ...BASE,
      libraryName: '<script>x</script>',
      publicUrl: null,
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
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

  it('omits any link when no public URL is configured', () => {
    const message = passwordResetMessage({ ...BASE, publicUrl: null });
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
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

describe('notification messages', () => {
  const base = {
    to: 'admin@example.com',
    libraryName: 'Bookplate',
    publicUrl: 'https://books.example.com',
    payload: {
      requesterUsername: 'alice',
      title: 'Dune',
      author: 'Frank Herbert',
      note: 'the 1965 edition if you can',
      declineReason: '',
    },
  };

  it('tells the admin who asked for what, and links to the queue', () => {
    const message = bookRequestedMessage(base);

    expect(message.to).toBe('admin@example.com');
    expect(message.subject).toBe('alice requested a book on Bookplate');
    expect(message.text).toContain('Dune');
    expect(message.text).toContain('Frank Herbert');
    expect(message.text).toContain('the 1965 edition if you can');
    expect(message.text).toContain('https://books.example.com/add/request');
    expect(message.html).toContain('href="https://books.example.com/add/request"');
  });

  it('omits the link entirely when publicUrl is null', () => {
    const message = bookRequestedMessage({ ...base, publicUrl: null });

    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('<a ');
  });

  it('omits the note line when there is no note', () => {
    const message = bookRequestedMessage({
      ...base,
      payload: { ...base.payload, note: '' },
    });
    expect(message.text).not.toContain('Note');
  });

  it('tells the reader their book arrived', () => {
    const message = requestFulfilledMessage({ ...base, to: 'alice@example.com' });

    expect(message.subject).toBe('Dune has been added to your library');
    expect(message.text).toContain('Frank Herbert');
  });

  it('tells the reader their request was declined, with the reason', () => {
    const message = requestDeclinedMessage({
      ...base,
      to: 'alice@example.com',
      payload: { ...base.payload, declineReason: 'already on the shelf' },
    });

    expect(message.subject).toBe('Your request for Dune was declined');
    expect(message.text).toContain('already on the shelf');
  });

  it('omits the reason line when a decline carries none', () => {
    const message = requestDeclinedMessage({ ...base, to: 'alice@example.com' });
    expect(message.text).not.toContain('Reason');
  });

  it('escapes operator- and user-supplied values in html', () => {
    const message = requestDeclinedMessage({
      ...base,
      to: 'alice@example.com',
      libraryName: '<script>',
      payload: { ...base.payload, title: '<b>x</b>', declineReason: '"quoted"' },
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).not.toContain('<b>x</b>');
    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(message.html).toContain('&quot;quoted&quot;');
  });
});
