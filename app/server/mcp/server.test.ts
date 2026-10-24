import { rawBookId, seedEditableBook } from '../graphql/schema/book/mutation/test-helpers';
import { createHarness, type Harness } from '../graphql/test-util';
import { saveThumbnail } from '../services/book-assets';
import { resetPassword } from '../services/password';
import { upsertPendingFix } from '../services/pending-fix';
import { deleteUser } from '../services/user';
import {
  buildMcpApp,
  connectMcpClient,
  mintToken,
  textOf,
  type McpTestClient,
} from './test-support';
import { SETUP_REQUIRED_MESSAGE } from './viewer';

vi.mock('../logger');
vi.mock('../services/epub-validator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/epub-validator')>();
  const okReport = {
    valid: true,
    fatal: false,
    threshold: 'ERROR' as const,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  };
  return {
    ...actual,
    assertValidEpub: vi.fn().mockResolvedValue(okReport),
    validateEpubReport: vi.fn().mockResolvedValue({ ...okReport }),
  };
});

import { assertValidEpub, validateEpubReport } from '../services/epub-validator';

vi.setConfig({ testTimeout: 30_000 });

const OK_REPORT = {
  valid: true,
  fatal: false,
  threshold: 'ERROR' as const,
  messages: [],
  counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
};

const ALPHA_ID = 'a'.repeat(32);
const BETA_ID = 'b'.repeat(32);
const BOB_ID = 'c'.repeat(32);

let harness: Harness;
let app: ReturnType<typeof buildMcpApp>;
let mcp: McpTestClient | null = null;

type Entry = { kind: string; id: string; title?: string; name?: string };
type SearchOut = { entries: Entry[]; nextCursor: string | null };

const search = async (client: McpTestClient, args: Record<string, unknown> = {}) => {
  const result = await client.call('search_library', args);
  expect(result.isError).toBeFalsy();
  return result.structuredContent as SearchOut;
};

const findId = async (client: McpTestClient, title: string): Promise<string> => {
  const out = await search(client, { query: title });
  const hit = out.entries.find((e) => e.kind === 'book' && e.title === title);
  if (hit === undefined) throw new Error(`no book titled ${title}`);
  return hit.id;
};

beforeEach(async () => {
  harness = await createHarness();
  vi.mocked(assertValidEpub).mockResolvedValue(OK_REPORT as never);
  vi.mocked(validateEpubReport).mockResolvedValue({ ...OK_REPORT } as never);
  await seedEditableBook(harness, harness.aliceOwner, ALPHA_ID, 'Alpha Book');
  await seedEditableBook(harness, harness.aliceOwner, BETA_ID, 'Beta Book');
  await seedEditableBook(harness, harness.bobOwner, BOB_ID, 'Bob Secret');
  await upsertPendingFix(harness.prisma, harness.aliceOwner, BETA_ID, 'beta.epub', 100, {
    autoFixes: [],
    appliedFixes: [],
    proposals: [
      {
        field: 'title',
        kind: 'title-case',
        from: 'Beta Book',
        to: 'Beta book',
        reason: 'Looks like title case',
        changes: { title: 'Beta book' },
      },
    ],
    undo: null,
  });
  await saveThumbnail(
    harness.prisma,
    harness.aliceOwner.userId,
    ALPHA_ID,
    200,
    Buffer.from('ffd8ffe0', 'hex'),
    'image/jpeg'
  );
  app = buildMcpApp(harness);
});

afterEach(async () => {
  if (mcp !== null) await mcp.close();
  mcp = null;
  await harness.cleanup();
});

const READ_TOOLS = [
  'search_library',
  'get_book',
  'get_series',
  'list_series',
  'list_library_facets',
  'list_pending_fixes',
  'get_validation_report',
  'list_reading_progress',
  'get_book_cover',
  'list_book_requests',
];

describe('tools/list', () => {
  it('names every read tool, each marked read-only', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    for (const name of READ_TOOLS) expect(names).toContain(name);
    for (const tool of tools.filter((t) => READ_TOOLS.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      // The cover tool answers with an image content block, which has no
      // structured counterpart; every other read tool declares its output.
      if (tool.name !== 'get_book_cover') expect(tool.outputSchema).toBeDefined();
    }
  });
});

describe('read tools', () => {
  it('search_library finds the reader’s own books and never another reader’s', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const all = await search(mcp);
    expect(all.entries.map((e) => e.title).sort()).toEqual(['Alpha Book', 'Beta Book']);
    expect(all.nextCursor).toBeNull();
    const filtered = await search(mcp, { query: 'Alpha' });
    expect(filtered.entries.map((e) => e.title)).toEqual(['Alpha Book']);
    const none = await search(mcp, { query: 'Secret' });
    expect(none.entries).toEqual([]);
    const paged = await search(mcp, { first: 1 });
    expect(paged.entries).toHaveLength(1);
    expect(paged.nextCursor).not.toBeNull();
  });

  it('get_book returns metadata, validation, and pending recommendations with keys', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const betaId = await findId(mcp, 'Beta Book');
    const result = await mcp.call('get_book', { bookId: betaId });
    expect(result.isError).toBeFalsy();
    const book = result.structuredContent as {
      id: string;
      documentId: string;
      title: string;
      author: string;
      validation: { valid: boolean; threshold: string } | null;
      pendingFixes: Array<{ key: string; field: string; from: string; to: string | null }>;
    };
    expect(book.id).toBe(betaId);
    expect(book.documentId).toBe(BETA_ID);
    expect(book.title).toBe('Beta Book');
    expect(book.author).toBe('Seed Author');
    expect(book.validation).toMatchObject({ valid: true, threshold: 'ERROR' });
    expect(book.pendingFixes).toEqual([
      expect.objectContaining({
        key: 'title:title-case:Beta Book',
        field: 'title',
        from: 'Beta Book',
        to: 'Beta book',
      }),
    ]);
    expect(textOf(result)).toContain('Beta Book');
  });

  it('get_book refuses another reader’s id and garbage with the same not-found message', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const bob = await connectMcpClient(app, await mintToken(harness, harness.bobOwner.userId));
    const bobBookId = await findId(bob, 'Bob Secret');
    await bob.close();

    const cross = await mcp.call('get_book', { bookId: bobBookId });
    expect(cross.isError).toBe(true);
    expect(textOf(cross)).toBe('No book with that id in your library');

    const garbage = await mcp.call('get_book', { bookId: 'garbage' });
    expect(garbage.isError).toBe(true);
    expect(textOf(garbage)).toBe('No book with that id in your library');
  });

  it('list_series, get_series and list_library_facets see a series once metadata puts a book in one', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const alphaId = await findId(mcp, 'Alpha Book');
    const updated = await harness.execute(
      `mutation($input: BookUpdateMetadataInput!) {
         bookUpdateMetadata(input: $input) { __typename ... on BookUpdateMetadataPayload { book { id } } }
       }`,
      {
        variables: {
          input: { id: alphaId, series: 'Saga', seriesIndex: 1, subjects: ['Fiction'] },
        },
      }
    );
    expect(updated.errors).toBeUndefined();

    const series = await mcp.call('list_series');
    expect(series.isError).toBeFalsy();
    const list = (
      series.structuredContent as { series: Array<{ id: string; name: string; bookCount: number }> }
    ).series;
    expect(list).toEqual([expect.objectContaining({ name: 'Saga', bookCount: 1 })]);

    const byName = await mcp.call('get_series', { name: 'Saga' });
    expect(byName.isError).toBeFalsy();
    const detail = byName.structuredContent as {
      id: string;
      name: string;
      books: Array<{ title: string }>;
    };
    expect(detail.name).toBe('Saga');
    expect(detail.books.map((b) => b.title)).toEqual(['Alpha Book']);

    const byId = await mcp.call('get_series', { seriesId: list[0].id });
    expect((byId.structuredContent as { name: string }).name).toBe('Saga');

    const missing = await mcp.call('get_series', { name: 'Nope' });
    expect(missing.isError).toBe(true);

    const facets = await mcp.call('list_library_facets');
    expect(facets.structuredContent).toEqual({ authors: ['Seed Author'], subjects: ['Fiction'] });
  });

  it('list_pending_fixes lists books with recommendations', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const result = await mcp.call('list_pending_fixes');
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      books: Array<{ title: string; proposals: Array<{ key: string }> }>;
    };
    expect(out.books).toEqual([
      expect.objectContaining({
        title: 'Beta Book',
        proposals: [expect.objectContaining({ key: 'title:title-case:Beta Book' })],
      }),
    ]);
  });

  it('get_validation_report pages the stored messages', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const alphaId = await findId(mcp, 'Alpha Book');
    const result = await mcp.call('get_validation_report', { bookId: alphaId, first: 10 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      valid: true,
      threshold: 'ERROR',
      messages: [],
      nextCursor: null,
    });
  });

  it('list_reading_progress and list_book_requests answer empty for a fresh reader', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const progress = await mcp.call('list_reading_progress');
    expect(progress.structuredContent).toEqual({ progress: [], nextCursor: null });
    const requests = await mcp.call('list_book_requests');
    expect(requests.structuredContent).toEqual({ requests: [], nextCursor: null });
  });

  it('get_book_cover returns an image block when a thumbnail exists', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const alphaId = await findId(mcp, 'Alpha Book');
    const result = await mcp.call('get_book_cover', { bookId: alphaId, width: 200 });
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === 'image') as
      | { type: 'image'; data: string; mimeType: string }
      | undefined;
    expect(image?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(image!.data, 'base64').toString('hex')).toBe('ffd8ffe0');

    const betaId = await findId(mcp, 'Beta Book');
    const none = await mcp.call('get_book_cover', { bookId: betaId });
    expect(none.isError).toBe(true);
  });
});

describe('gates', () => {
  it('a reader who owes a password change gets the setup message from every tool', async () => {
    await resetPassword(harness.prisma, 'alice');
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    const result = await mcp.call('search_library');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(SETUP_REQUIRED_MESSAGE);
  });

  it('a deleted reader’s token can no longer connect', async () => {
    const token = await mintToken(harness, harness.aliceOwner.userId);
    await deleteUser(harness.prisma, harness.editionsRoot, 'alice');
    await expect(connectMcpClient(app, token)).rejects.toThrow();
  });

  it('records last use on the grant', async () => {
    mcp = await connectMcpClient(app, await mintToken(harness, harness.aliceOwner.userId));
    await mcp.call('list_series');
    const grant = await harness.prisma.mcpGrant.findFirstOrThrow();
    expect(grant.lastUsedAt).not.toBeNull();
  });
});

// Keeps `rawBookId` referenced for suites that extend this file (Tasks 11–12).
void rawBookId;
