import * as fs from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import sharp from 'sharp';

import {
  fixtureEpub,
  EMPTY_COUNTS,
  seedEditableBook,
} from '../graphql/schema/book/mutation/test-helpers';
import { createHarness, type Harness } from '../graphql/test-util';
import { createMcpToken, deleteMcpToken } from '../services/mcp-token';
import { createMcpRouter, transferBaseUrl } from './mcp';

vi.mock('../logger');
vi.mock('../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/epub-validator')>();
  return { ...actual, assertValidEpub: vi.fn(), validateEpubReport: vi.fn() };
});

import { assertValidEpub, validateEpubReport } from '../services/epub-validator';

const okReport = {
  valid: true,
  fatal: false,
  threshold: 'ERROR' as const,
  messages: [],
  counts: EMPTY_COUNTS,
};

let harness: Harness;
let httpServer: Server;
let baseUrl: string;
let token: string;
let tokenId: string;
let client: Client;

async function connect(bearer: string): Promise<Client> {
  const c = new Client({ name: 'bookplate-test', version: '0.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    })
  );
  return c;
}

type ToolResult = { isError: boolean; body: Record<string, unknown> };

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
}

/** Calls a tool that must succeed, returning its parsed JSON. */
async function ok<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.body)}`);
  return result.body as T;
}

async function uploadFile(kind: 'epub' | 'cover', filename: string, bytes: Buffer) {
  const { uploadUrl } = await ok<{ uploadUrl: string }>('create_upload_url', { kind, filename });
  const res = await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(bytes) });
  expect(res.status).toBe(200);
  return (await res.json()) as { stagedUploadId: string; sizeBytes: number };
}

async function addBook(title: string, author?: string) {
  const { stagedUploadId } = await uploadFile('epub', `${title}.epub`, fixtureEpub(title, author));
  return ok<{ book: { id: string; title: string } }>('add_book', { stagedUploadId });
}

beforeEach(async () => {
  vi.mocked(assertValidEpub).mockResolvedValue(okReport);
  vi.mocked(validateEpubReport).mockResolvedValue(okReport);
  harness = await createHarness();
  const app = express();
  app.use('/mcp', createMcpRouter(harness.contextDeps()));
  httpServer = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const created = await createMcpToken(harness.prisma, {
    userId: harness.aliceOwner.userId,
    label: 'test',
  });
  token = created!.token;
  tokenId = created!.row.id;
  client = await connect(token);
});

afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await harness.cleanup();
});

describe('authentication', () => {
  it('refuses a request without a valid agent token', async () => {
    for (const authorization of [undefined, 'Bearer bpmcp_unknown', `Basic ${token}`]) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
    }
  });

  it('stops working the moment the token is revoked', async () => {
    await deleteMcpToken(harness.prisma, { userId: harness.aliceOwner.userId, id: tokenId });
    await expect(client.listTools()).rejects.toThrow();
  });

  it('answers GET with 405, since the server keeps no sessions', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(405);
  });
});

describe('tools', () => {
  it('lists the first-pass tool set', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_book',
      'analyze_book_replacement',
      'create_upload_url',
      'get_book',
      'get_book_download_url',
      'get_series',
      'list_book_requests',
      'replace_book',
      'request_book',
      'search_library',
      'update_book_metadata',
      'validate_book',
    ]);
  });

  it("searches and reads the reader's own library, and nobody else's", async () => {
    await seedEditableBook(harness, harness.aliceOwner, 'a'.repeat(32), 'Dune');
    await seedEditableBook(harness, harness.bobOwner, 'b'.repeat(32), 'Bob Only');

    const all = await ok<{ entries: { id: string; title: string }[] }>('search_library');
    expect(all.entries.map((e) => e.title)).toEqual(['Dune']);

    const book = await ok<{ title: string; validation: { valid: boolean } }>('get_book', {
      bookId: all.entries[0].id,
    });
    expect(book).toMatchObject({ title: 'Dune', validation: { valid: true } });

    // Bob's book, addressed by its real id, is indistinguishable from a missing one.
    const bobBooks = await harness.execute(
      `{ viewer { library { entries(first: 1) { edges { node { ... on Book { id } } } } } } }`,
      {
        viewer: harness.bobViewer,
      }
    );
    const bobBookId = (
      bobBooks.data as { viewer: { library: { entries: { edges: { node: { id: string } }[] } } } }
    ).viewer.library.entries.edges[0].node.id;
    const denied = await call('get_book', { bookId: bobBookId });
    expect(denied.isError).toBe(true);
    expect(String(denied.body.error)).toMatch(/not found|No book/i);

    const malformed = await call('get_book', { bookId: 'nonsense' });
    expect(malformed).toEqual({ isError: true, body: { error: '"nonsense" is not a book id.' } });
  });

  it('adds an uploaded book, then downloads the same bytes back', async () => {
    const added = await addBook('Dune');
    expect(added.book.title).toBe('Dune');

    const { downloadUrl } = await ok<{ downloadUrl: string }>('get_book_download_url', {
      bookId: added.book.id,
    });
    const res = await fetch(downloadUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/epub+zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="/);
    const row = await harness.prisma.book.findFirstOrThrow({ where: { title: 'Dune' } });
    const onDisk = fs.readFileSync(
      `${harness.config.booksDir}/${harness.aliceOwner.username}/${row.id}.epub`
    );
    expect(Buffer.from(await res.arrayBuffer()).equals(onDisk)).toBe(true);
  });

  it('kills transfer URLs when their token is revoked', async () => {
    const added = await addBook('Dune');
    const { downloadUrl } = await ok<{ downloadUrl: string }>('get_book_download_url', {
      bookId: added.book.id,
    });
    const { uploadUrl } = await ok<{ uploadUrl: string }>('create_upload_url', {
      kind: 'epub',
      filename: 'x.epub',
    });

    await deleteMcpToken(harness.prisma, { userId: harness.aliceOwner.userId, id: tokenId });

    expect((await fetch(downloadUrl)).status).toBe(403);
    expect(
      (await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(fixtureEpub('x')) })).status
    ).toBe(403);
  });

  it('refuses a duplicate add, naming the existing book', async () => {
    const first = await addBook('Dune');
    const { stagedUploadId } = await uploadFile('epub', 'again.epub', fixtureEpub('Dune'));
    const again = await call('add_book', { stagedUploadId });
    expect(again.isError).toBe(true);
    expect(again.body).toMatchObject({
      errorType: 'BookHashCollisionError',
      existingBook: { id: first.book.id, title: 'Dune' },
    });
  });

  it('edits metadata, reports the new id, and finds the book in its new series', async () => {
    const added = await addBook('Dune');
    // `bookAdd` persists the validation report the (mocked) checker returned.
    const edited = await ok<{
      previousId: string;
      book: { id: string; title: string; series: { name: string } };
    }>('update_book_metadata', {
      bookId: added.book.id,
      title: 'Dune (1965)',
      series: 'Dune Saga',
      seriesIndex: 1,
    });
    expect(edited.previousId).toBe(added.book.id);
    expect(edited.book.id).not.toBe(added.book.id);
    expect(edited.book).toMatchObject({ title: 'Dune (1965)', series: { name: 'Dune Saga' } });

    const byName = await ok<{ id: string; books: { id: string }[] }>('get_series', {
      name: 'Dune Saga',
    });
    expect(byName.books.map((b) => b.id)).toEqual([edited.book.id]);
    const byId = await ok<{ name: string }>('get_series', { seriesId: byName.id });
    expect(byId.name).toBe('Dune Saga');

    const stale = await call('get_book', { bookId: added.book.id });
    expect(stale.isError).toBe(true);
  });

  it('reports invalid metadata input as a readable error', async () => {
    const added = await addBook('Dune');
    const result = await call('update_book_metadata', {
      bookId: added.book.id,
      publishDate: 'last tuesday',
    });
    expect(result.isError).toBe(true);
    expect(result.body).toMatchObject({
      errorType: 'InvalidInputError',
      issues: [{ field: 'publishDate' }],
    });
  });

  it('sets a cover from an uploaded image', async () => {
    const added = await addBook('Dune');
    const png = await sharp({
      create: { width: 4, height: 6, channels: 3, background: { r: 200, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const { stagedUploadId } = await uploadFile('cover', 'cover.png', png);

    const edited = await ok<{ book: { hasCover: boolean } }>('update_book_metadata', {
      bookId: added.book.id,
      coverStagedUploadId: stagedUploadId,
    });
    expect(edited.book.hasCover).toBe(true);
  });

  it('validates a book on demand', async () => {
    const added = await addBook('Dune');
    const result = await ok<{ validation: { valid: boolean; counts: Record<string, number> } }>(
      'validate_book',
      { bookId: added.book.id }
    );
    expect(result.validation.valid).toBe(true);
    // Only severities with findings are listed.
    expect(result.validation.counts).toEqual({});
  });

  it("previews and then replaces a book's file", async () => {
    const added = await addBook('Dune');
    const { stagedUploadId } = await uploadFile(
      'epub',
      'Dune v2.epub',
      fixtureEpub('Dune, Revised', 'Frank Herbert')
    );

    const preview = await ok<{ valid: boolean }>('analyze_book_replacement', {
      bookId: added.book.id,
      stagedUploadId,
    });
    expect(preview.valid).toBe(true);

    const replaced = await ok<{ previousId: string; book: { id: string; title: string } }>(
      'replace_book',
      { bookId: added.book.id, stagedUploadId }
    );
    expect(replaced.book.title).toBe('Dune, Revised');
    expect(replaced.book.id).not.toBe(added.book.id);
    expect(await harness.prisma.book.count({ where: { userId: harness.aliceOwner.userId } })).toBe(
      1
    );
  });

  it('requests a book and lists the request', async () => {
    const created = await ok<{ id: string; status: string }>('request_book', {
      title: 'Children of Dune',
      author: 'Frank Herbert',
      note: 'Any edition',
    });
    expect(created.status).toBe('PENDING');

    const duplicate = await call('request_book', {
      title: 'children of dune',
      author: 'frank herbert',
    });
    // The same id list_book_requests reports for it.
    expect(duplicate).toMatchObject({
      isError: true,
      body: { errorType: 'DuplicateBookRequestError', existingRequestId: created.id },
    });

    const listed = await ok<{ pendingCount: number; requests: { id: string }[] }>(
      'list_book_requests'
    );
    expect(listed).toMatchObject({ pendingCount: 1, requests: [{ id: created.id }] });
  });
});

describe('transfer URLs', () => {
  it('only mints an upload URL for a plausible file name', async () => {
    expect((await call('create_upload_url', { kind: 'epub', filename: 'book.pdf' })).isError).toBe(
      true
    );
    expect(
      (await call('create_upload_url', { kind: 'cover', filename: 'cover.txt' })).isError
    ).toBe(true);
  });

  it('refuses a forged ticket and an empty body', async () => {
    expect((await fetch(`${baseUrl}/mcp/upload/forged`, { method: 'PUT', body: 'x' })).status).toBe(
      403
    );
    expect((await fetch(`${baseUrl}/mcp/download/forged`)).status).toBe(403);

    const { uploadUrl } = await ok<{ uploadUrl: string }>('create_upload_url', {
      kind: 'epub',
      filename: 'empty.epub',
    });
    expect((await fetch(uploadUrl, { method: 'PUT' })).status).toBe(400);
  });

  it('refuses an upload ticket used as a download ticket', async () => {
    const { uploadUrl } = await ok<{ uploadUrl: string }>('create_upload_url', {
      kind: 'epub',
      filename: 'x.epub',
    });
    const ticket = uploadUrl.split('/').pop();
    expect((await fetch(`${baseUrl}/mcp/download/${ticket}`)).status).toBe(403);
  });
});

describe('transferBaseUrl', () => {
  const req = (headers: Record<string, string>, protocol = 'http') =>
    ({
      headers,
      protocol,
      get: (name: string) => headers[name.toLowerCase()],
    }) as unknown as express.Request;

  it('prefers the configured public URL', () => {
    expect(transferBaseUrl(req({ host: 'evil.example' }), 'https://books.example.com')).toBe(
      'https://books.example.com'
    );
  });

  it("otherwise uses the request's own origin, honouring an HTTPS proxy", () => {
    expect(transferBaseUrl(req({ host: 'nas.local:3000' }), null)).toBe('http://nas.local:3000');
    expect(
      transferBaseUrl(req({ host: 'books.example.com', 'x-forwarded-proto': 'https, http' }), null)
    ).toBe('https://books.example.com');
    expect(transferBaseUrl(req({ host: 'h', 'x-forwarded-proto': 'gopher' }), null)).toBe(
      'http://h'
    );
  });
});
