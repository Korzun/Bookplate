import * as fs from 'fs';
import * as path from 'path';

import { fixtureEpub } from '../graphql/schema/book/mutation/test-helpers';
import { createHarness, type Harness } from '../graphql/test-util';
import { getStagingDir } from './book-paths';
import { importEpub } from './import-epub';

vi.mock('../logger');
vi.mock('./epub-validator', () => {
  class EpubValidationError extends Error {
    messages: { id: string; severity: string; message: string }[];
    counts: Record<string, number>;
    threshold: string;
    constructor(
      messages: { id: string; severity: string; message: string }[],
      counts: Record<string, number>,
      threshold: string
    ) {
      super('EPUB failed validation');
      this.name = 'EpubValidationError';
      this.messages = messages;
      this.counts = counts;
      this.threshold = threshold;
    }
  }
  const okReport = {
    valid: true,
    fatal: false,
    threshold: 'ERROR' as const,
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  };
  return {
    EpubValidationError,
    assertValidEpub: vi.fn().mockResolvedValue(okReport),
    validateEpubReport: vi.fn().mockResolvedValue({ ...okReport }),
    toValidationReport: vi.fn((report: { valid: boolean }, threshold: string) => ({
      valid: report.valid,
      messages: [],
      counts: okReport.counts,
      threshold,
    })),
  };
});

import { assertValidEpub, EpubValidationError } from './epub-validator';

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  vi.mocked(assertValidEpub).mockResolvedValue({
    valid: true,
    fatal: false,
    threshold: 'ERROR',
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
  } as never);
});

afterEach(async () => {
  await harness.cleanup();
});

const stage = (name: string, bytes: Buffer): string => {
  const dir = getStagingDir(harness.config.booksDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(file, bytes);
  return file;
};

const deps = () => ({
  prisma: harness.prisma,
  config: harness.config,
  editionsRoot: harness.editionsRoot,
  thumbnailQueue: harness.thumbnails,
});

describe('importEpub', () => {
  it('imports a valid EPUB and reports the new book id', async () => {
    const bytes = fixtureEpub('Imported Title', 'Some Author');
    const file = stage('book.epub', bytes);

    const result = await importEpub(deps(), harness.aliceOwner, {
      path: file,
      originalName: 'book.epub',
      size: bytes.length,
    });

    expect(result.kind).toBe('imported');
    if (result.kind !== 'imported') return;
    const row = await harness.prisma.book.findUnique({
      where: { userId_id: { userId: harness.aliceOwner.userId, id: result.bookId } },
    });
    expect(row?.title).toBe('Imported Title');
    expect(fs.existsSync(file)).toBe(false); // moved into the library
    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.proposals)).toBe(true);
  });

  it('reports a duplicate fingerprint and removes the staged file', async () => {
    const bytes = fixtureEpub('Twice');
    const first = await importEpub(deps(), harness.aliceOwner, {
      path: stage('a.epub', bytes),
      originalName: 'a.epub',
      size: bytes.length,
    });
    expect(first.kind).toBe('imported');

    const file = stage('b.epub', bytes);
    const second = await importEpub(deps(), harness.aliceOwner, {
      path: file,
      originalName: 'b.epub',
      size: bytes.length,
    });
    expect(second).toEqual({ kind: 'duplicate' });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('reports an unparsable file and removes it', async () => {
    const file = stage('junk.epub', Buffer.from('not a zip'));
    const result = await importEpub(deps(), harness.aliceOwner, {
      path: file,
      originalName: 'junk.epub',
      size: 9,
    });
    expect(result.kind).toBe('parse_failed');
    if (result.kind === 'parse_failed') expect(result.message).toMatch(/.+/);
    expect(fs.existsSync(file)).toBe(false);
    expect(await harness.prisma.book.count()).toBe(0);
  });

  it('reports a validation failure with the report and removes the file', async () => {
    vi.mocked(assertValidEpub).mockRejectedValueOnce(
      new EpubValidationError(
        [{ id: 'RSC-001', severity: 'ERROR', message: 'broken' }],
        { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
        'ERROR'
      )
    );
    const bytes = fixtureEpub('Invalid');
    const file = stage('bad.epub', bytes);
    const result = await importEpub(deps(), harness.aliceOwner, {
      path: file,
      originalName: 'bad.epub',
      size: bytes.length,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.validation.threshold).toBe('ERROR');
      expect(result.validation.counts.ERROR).toBe(1);
    }
    expect(fs.existsSync(file)).toBe(false);
    expect(await harness.prisma.book.count()).toBe(0);
  });
});
