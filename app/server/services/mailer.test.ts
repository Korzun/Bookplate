import { describe, expect, it } from 'vitest';

import { createMailer, isMailConfigured } from './mailer';

const MAIL = { accountId: 'a', apiToken: 't', from: 'f@example.com', fromName: 'F' };

describe('createMailer', () => {
  it('returns null when mail is null', () => {
    expect(createMailer(null)).toBeNull();
  });

  it('returns null when mail is undefined', () => {
    expect(createMailer(undefined)).toBeNull();
  });

  it('returns a sender when mail is configured', () => {
    expect(typeof createMailer(MAIL)?.send).toBe('function');
  });
});

describe('isMailConfigured', () => {
  it('is false for an absent or null mail config', () => {
    expect(isMailConfigured({})).toBe(false);
    expect(isMailConfigured({ mail: null })).toBe(false);
  });

  it('is true for a populated mail config', () => {
    expect(isMailConfigured({ mail: MAIL })).toBe(true);
  });
});
