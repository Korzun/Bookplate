import { describe, expect, it, vi } from 'vitest';

import { logger } from '../logger';
import { createMailer, isMailConfigured } from './mailer';

vi.mock('../logger', () => {
  const info = vi.fn();
  return { logger: () => ({ debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() }) };
});

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

describe('createMailer — log driver', () => {
  it('prints the message instead of sending it, and reports success', async () => {
    const mailer = createMailer({ driver: 'log', from: 'f@localhost', fromName: 'F' });
    const result = await mailer!.send({
      to: 'reader@example.com',
      subject: 'Your account',
      text: 'Code: K7M2QX4P',
      html: '<p>Code</p>',
    });

    expect(result).toEqual({ ok: true });
    const printed = vi
      .mocked(logger('Mailer').info)
      .mock.calls.map(([line]) => line)
      .join('\n');
    expect(printed).toContain('reader@example.com');
    expect(printed).toContain('Your account');
    expect(printed).toContain('Code: K7M2QX4P');
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
