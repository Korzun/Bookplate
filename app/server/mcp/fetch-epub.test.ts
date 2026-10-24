import { EventEmitter } from 'events';
import type * as https from 'https';
import { PassThrough } from 'stream';

import { fetchEpub, FetchEpubError, type FetchEpubOptions } from './fetch-epub';

type Scripted = {
  status: number;
  headers?: Record<string, string>;
  body?: Buffer | string;
  /** Emit the body in chunks of this size to exercise the running byte cap. */
  chunk?: number;
};

/**
 * A stand-in for `https.request` that answers from a script keyed by URL
 * origin+path, recording what it was asked to connect to. Each call returns a
 * ClientRequest-like emitter whose `response` is a readable stream.
 */
const scriptedRequest = (script: Record<string, Scripted>) => {
  const calls: Array<{ url: string; options: https.RequestOptions }> = [];
  const request = ((
    url: string | URL,
    options: https.RequestOptions,
    cb?: (res: never) => void
  ) => {
    const key = typeof url === 'string' ? url : url.href;
    calls.push({ url: key, options });
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (err?: Error) => void;
      destroyed: boolean;
      setTimeout: () => void;
    };
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    req.setTimeout = () => {};
    req.end = () => {
      const entry = script[key];
      setImmediate(() => {
        if (entry === undefined) {
          req.emit('error', new Error(`no script for ${key}`));
          return;
        }
        const res = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        res.statusCode = entry.status;
        res.headers = entry.headers ?? {};
        cb?.(res as never);
        const body = Buffer.isBuffer(entry.body)
          ? entry.body
          : Buffer.from(entry.body ?? '', 'utf8');
        const size = (entry.chunk ?? body.length) || 1;
        for (let i = 0; i < body.length; i += size) res.write(body.subarray(i, i + size));
        res.end();
      });
    };
    return req as never;
  }) as unknown as typeof https.request;
  return { request, calls };
};

const publicLookup: NonNullable<FetchEpubOptions['lookup']> = (_host, _opts, cb) =>
  cb(null, [{ address: '203.0.113.10', family: 4 }]);

const privateLookup: NonNullable<FetchEpubOptions['lookup']> = (_host, _opts, cb) =>
  cb(null, [{ address: '127.0.0.1', family: 4 }]);

const epubHeaders = { 'content-type': 'application/epub+zip' };

const expectCode = async (promise: Promise<unknown>, code: FetchEpubError['code']) => {
  await expect(promise).rejects.toBeInstanceOf(FetchEpubError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('fetchEpub', () => {
  it('refuses a non-https URL and an unparsable one', async () => {
    const { request } = scriptedRequest({});
    await expectCode(
      fetchEpub('http://books.example/a.epub', { request, lookup: publicLookup }),
      'invalid_url'
    );
    await expectCode(fetchEpub('not a url', { request, lookup: publicLookup }), 'invalid_url');
  });

  it('refuses a private IP literal without connecting', async () => {
    const { request, calls } = scriptedRequest({});
    await expectCode(
      fetchEpub('https://10.0.0.1/a.epub', { request, lookup: publicLookup }),
      'private_host'
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a public name that resolves to a private address', async () => {
    const { request, calls } = scriptedRequest({});
    await expectCode(
      fetchEpub('https://evil.example/a.epub', { request, lookup: privateLookup }),
      'private_host'
    );
    expect(calls).toHaveLength(0);
  });

  it('pins the connection to the resolved address', async () => {
    const { request, calls } = scriptedRequest({
      'https://books.example/a.epub': { status: 200, headers: epubHeaders, body: 'PK..' },
    });
    const out = await fetchEpub('https://books.example/a.epub', { request, lookup: publicLookup });
    expect(out.bytes.toString()).toBe('PK..');
    expect(out.filename).toBe('a.epub');
    expect(calls[0].options.servername).toBe('books.example');
    expect(typeof calls[0].options.lookup).toBe('function');
    // The pinned lookup hands net the address we vetted, never re-resolving.
    const pinned = calls[0].options.lookup!;
    await new Promise<void>((resolve) => {
      pinned(
        'books.example',
        { all: false } as never,
        ((err: unknown, address: string) => {
          expect(err).toBeNull();
          expect(address).toBe('203.0.113.10');
          resolve();
        }) as never
      );
    });
  });

  it('follows one public redirect and refuses a redirect into a private address', async () => {
    const { request } = scriptedRequest({
      'https://books.example/go': {
        status: 302,
        headers: { location: 'https://cdn.example/b.epub' },
      },
      'https://cdn.example/b.epub': { status: 200, headers: epubHeaders, body: 'PKbb' },
      'https://books.example/bad': {
        status: 302,
        headers: { location: 'https://192.168.0.1/x.epub' },
      },
    });
    const out = await fetchEpub('https://books.example/go', { request, lookup: publicLookup });
    expect(out.bytes.toString()).toBe('PKbb');
    expect(out.filename).toBe('b.epub');
    await expectCode(
      fetchEpub('https://books.example/bad', { request, lookup: publicLookup }),
      'private_host'
    );
  });

  it('gives up after too many redirects', async () => {
    const script: Record<string, Scripted> = {};
    for (let i = 0; i < 7; i += 1) {
      script[`https://books.example/r${i}`] = {
        status: 302,
        headers: { location: `https://books.example/r${i + 1}` },
      };
    }
    const { request } = scriptedRequest(script);
    await expectCode(
      fetchEpub('https://books.example/r0', { request, lookup: publicLookup }),
      'too_many_redirects'
    );
  });

  it('stops reading past the byte cap', async () => {
    const { request } = scriptedRequest({
      'https://books.example/big.epub': {
        status: 200,
        headers: epubHeaders,
        body: Buffer.alloc(1001, 1),
        chunk: 100,
      },
    });
    await expectCode(
      fetchEpub('https://books.example/big.epub', {
        request,
        lookup: publicLookup,
        maxBytes: 1000,
      }),
      'too_large'
    );
  });

  it('refuses a declared Content-Length over the cap before reading', async () => {
    const { request } = scriptedRequest({
      'https://books.example/huge.epub': {
        status: 200,
        headers: { ...epubHeaders, 'content-length': '5000' },
        body: 'x',
      },
    });
    await expectCode(
      fetchEpub('https://books.example/huge.epub', {
        request,
        lookup: publicLookup,
        maxBytes: 1000,
      }),
      'too_large'
    );
  });

  it('refuses something that is neither typed nor named as an EPUB, and non-2xx answers', async () => {
    const { request } = scriptedRequest({
      'https://books.example/page': {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: '<html>',
      },
      'https://books.example/named.epub': {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: 'PK',
      },
      'https://books.example/missing.epub': { status: 404, body: 'nope' },
    });
    await expectCode(
      fetchEpub('https://books.example/page', { request, lookup: publicLookup }),
      'not_epub'
    );
    const named = await fetchEpub('https://books.example/named.epub', {
      request,
      lookup: publicLookup,
    });
    expect(named.filename).toBe('named.epub');
    await expectCode(
      fetchEpub('https://books.example/missing.epub', { request, lookup: publicLookup }),
      'http_error'
    );
  });

  it('takes the filename from Content-Disposition when present, forcing .epub', async () => {
    const { request } = scriptedRequest({
      'https://books.example/dl?id=7': {
        status: 200,
        headers: { ...epubHeaders, 'content-disposition': 'attachment; filename="My Book.epub"' },
        body: 'PK',
      },
      'https://books.example/dl?id=8': {
        status: 200,
        headers: {
          ...epubHeaders,
          'content-disposition': "attachment; filename*=UTF-8''Caf%C3%A9",
        },
        body: 'PK',
      },
    });
    expect(
      (await fetchEpub('https://books.example/dl?id=7', { request, lookup: publicLookup })).filename
    ).toBe('My Book.epub');
    expect(
      (await fetchEpub('https://books.example/dl?id=8', { request, lookup: publicLookup })).filename
    ).toBe('Café.epub');
  });
});
