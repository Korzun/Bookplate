import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

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

/**
 * `services/mailer-cloudflare.ts` doesn't mock `../logger` (unlike its
 * siblings) — nothing here asserts on a LOGGED MESSAGE, only on `SendResult`,
 * so mocking the whole module would be one more thing to keep in sync for no
 * test value. But every failure path this suite deliberately exercises
 * (bounce, misconfigured, throttled, transient, network) calls the REAL
 * `logger`, which writes straight to the real `process.stderr`/`stdout` (D5,
 * whole-branch review) — seven lines of `WARN`/`ERROR [Mailer] ...` noise on
 * every full test run. Silencing the SINK, not the logger module, keeps the
 * "logs a misconfiguration only once" test below working unchanged: it
 * asserts on `process.stderr.write` being called, which still happens against
 * this spy — it just doesn't print.
 */
let stderrSpy: MockInstance;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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

  // Minor (whole-branch review): `body.errors?.map(...).join('; ') ?? 'no
  // detail'` never fires its fallback for an empty `errors: []` — `[].join`
  // is `''`, which is not nullish — so the log line read
  // `WARN [Mailer] Send failed (500): ` with nothing after the colon.
  // Falsifiable: reverting `||` to `??` below makes this see an empty string
  // instead of 'no detail'.
  it("logs 'no detail' for a failure with an empty errors array, not a blank message", async () => {
    stubFetch(() => json(500, { success: false, errors: [] }));
    await createCloudflareMailer(MAIL).send(MESSAGE);
    const line = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes('Send failed'));
    expect(line).toContain('no detail');
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

  // The outbound fetch must not be allowed to hang past a short bound: a
  // resend button is the retry path, so there is no reason to hold the
  // socket for anywhere near the app-wide 90s request timeout. Node's fetch
  // rejects an `AbortSignal.timeout()`-aborted request with a `DOMException`
  // named `TimeoutError` (verified against a live non-responding server),
  // which `instanceof Error` — so it lands in the same network-error catch
  // as any other fetch rejection, with no special-casing needed.
  it('reports an aborted (timed-out) send as transient', async () => {
    const fetchMock = stubFetch(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a 400 with a success:false body as transient, not a bad address', async () => {
    stubFetch(() => json(400, { success: false, errors: [{ code: 1, message: 'bad content' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  // Correctness, not security: the value goes into a JSON body and Cloudflare
  // composes the message, so there is no header-injection risk here. This is
  // purely about producing a valid From header when `fromName` (the
  // operator's free-text `library_name` add-on option) contains characters
  // RFC 5322 reserves as `specials`.
  describe('From display-name quoting', () => {
    const sendWithFromName = async (fromName: string) => {
      const fetchMock = stubFetch(() => json(200, { success: true, result: { delivered: [] } }));
      await createCloudflareMailer({ ...MAIL, fromName }).send(MESSAGE);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return (JSON.parse(init.body as string) as { from: string }).from;
    };

    it('passes a plain name through unchanged', async () => {
      expect(await sendWithFromName('My Library')).toBe('My Library <lib@example.com>');
    });

    it('quotes and escapes a name containing "<"', async () => {
      expect(await sendWithFromName('Bob <Evil>')).toBe('"Bob <Evil>" <lib@example.com>');
    });

    it('quotes and escapes a name containing a double quote', async () => {
      expect(await sendWithFromName('Bob "The Man"')).toBe('"Bob \\"The Man\\"" <lib@example.com>');
    });

    it('quotes a name containing a comma', async () => {
      expect(await sendWithFromName('Smith, Bob')).toBe('"Smith, Bob" <lib@example.com>');
    });
  });

  it('logs a misconfiguration only once per mailer instance', async () => {
    // `logger('Mailer').error` writes a line via `process.stderr.write`, not
    // `console.error` (see app/server/logger.ts) — the shared `stderrSpy`
    // above is the real sink, already silenced; this test only reads its
    // call log, it doesn't need its own spy.
    stubFetch(() => json(401, { success: false, errors: [] }));
    const mailer = createCloudflareMailer(MAIL);
    await mailer.send(MESSAGE);
    await mailer.send(MESSAGE);
    expect(stderrSpy.mock.calls.filter((c) => String(c[0]).includes('Email Sending'))).toHaveLength(
      1
    );
  });
});
