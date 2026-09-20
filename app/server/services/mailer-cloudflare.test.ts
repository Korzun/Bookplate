import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCloudflareMailer } from './mailer-cloudflare';

const MAIL = { accountId: 'acct', apiToken: 'tok', from: 'lib@example.com', fromName: 'Lib' };
const MESSAGE = { to: 'reader@example.com', subject: 'Hi', text: 'plain', html: '<p>plain</p>' };

const stubFetch = (impl: (url: string, init: RequestInit) => unknown) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

const json = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createCloudflareMailer', () => {
  it('posts to the account send endpoint with a bearer token', async () => {
    const fetchMock = stubFetch(() =>
      json(200, { success: true, result: { delivered: [MESSAGE.to] } })
    );

    const result = await createCloudflareMailer(MAIL).send(MESSAGE);

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'reader@example.com',
      from: 'Lib <lib@example.com>',
      subject: 'Hi',
      text: 'plain',
      html: '<p>plain</p>',
    });
  });

  it('reports a permanent bounce inside a 200 as a bad address', async () => {
    stubFetch(() =>
      json(200, { success: true, result: { delivered: [], permanent_bounces: [MESSAGE.to] } })
    );
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'bad_address',
    });
  });

  it.each([401, 403])('reports %i as misconfigured', async (status) => {
    stubFetch(() => json(status, { success: false, errors: [{ code: 10000, message: 'no' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'misconfigured',
    });
  });

  it('reports 429 as throttled', async () => {
    stubFetch(() => json(429, { success: false, errors: [{ code: 10004, message: 'rate' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'throttled',
    });
  });

  it('reports a 500 as transient', async () => {
    stubFetch(() => json(500, { success: false, errors: [] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('reports a network failure as transient rather than throwing', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('reports a 400 with a success:false body as transient, not a bad address', async () => {
    stubFetch(() => json(400, { success: false, errors: [{ code: 1, message: 'bad content' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('logs a misconfiguration only once per mailer instance', async () => {
    // `logger('Mailer').error` writes a line via `process.stderr.write`, not
    // `console.error` (see app/server/logger.ts) — spy on the real sink.
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stubFetch(() => json(401, { success: false, errors: [] }));
    const mailer = createCloudflareMailer(MAIL);
    await mailer.send(MESSAGE);
    await mailer.send(MESSAGE);
    expect(stderr.mock.calls.filter((c) => String(c[0]).includes('Email Sending'))).toHaveLength(1);
  });
});
