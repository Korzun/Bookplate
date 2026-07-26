import type { Message, Report } from '@korzun/epubcheck-ts';
import { validateEpub } from '@korzun/epubcheck-ts';
import type { MockedFunction } from 'vitest';

import {
  assertValidEpub,
  EpubValidationError,
  formatMessages,
  splitSubjects,
  toValidationReport,
  validateEpubReport,
} from './epub-validator';

vi.mock('@korzun/epubcheck-ts', () => ({ validateEpub: vi.fn() }));

const mockValidate = validateEpub as MockedFunction<typeof validateEpub>;
const mockValidateEpub = validateEpub as unknown as ReturnType<typeof vi.fn>;

function report(partial: Partial<Report>): Report {
  return {
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    threshold: 'ERROR',
    fatal: false,
    valid: true,
    ...partial,
  };
}

describe('assertValidEpub', () => {
  beforeEach(() => mockValidate.mockReset());

  it('forwards the threshold to validateEpub', async () => {
    mockValidate.mockResolvedValue(report({ valid: true }));
    await assertValidEpub(Buffer.from('x'), 'WARNING');
    expect(mockValidate).toHaveBeenCalledWith(expect.anything(), { threshold: 'WARNING' });
  });

  it('returns the report when valid', async () => {
    const r = report({
      valid: true,
      counts: { FATAL: 0, ERROR: 0, WARNING: 2, INFO: 0, USAGE: 0 },
    });
    mockValidate.mockResolvedValue(r);
    await expect(assertValidEpub(Buffer.from('x'), 'ERROR')).resolves.toBe(r);
  });

  it('carries all messages but summarizes only the blocking ones', async () => {
    const r = report({
      valid: false,
      counts: { FATAL: 1, ERROR: 1, WARNING: 1, INFO: 0, USAGE: 0 },
      messages: [
        { id: 'PKG-003', severity: 'FATAL', message: 'unreadable' },
        { id: 'RSC-005', severity: 'ERROR', message: 'parse error' },
        { id: 'PKG-001', severity: 'WARNING', message: 'version mismatch' },
      ] as Report['messages'],
    });
    mockValidate.mockResolvedValue(r);

    const err = await assertValidEpub(Buffer.from('x'), 'ERROR').catch((e) => e);
    expect(err).toBeInstanceOf(EpubValidationError);
    // messages now carries every severity, not just the blocking subset
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual([
      'PKG-003',
      'RSC-005',
      'PKG-001',
    ]);
    expect(err.counts).toEqual(r.counts);
    expect(err.threshold).toBe('ERROR');
    // the summary string still reflects only the blocking severities
    expect(err.message).toBe('EPUB failed validation (threshold ERROR): 1 fatal, 1 error');
  });

  it('summarizes the blocking messages in the error message, keyed to the threshold', async () => {
    // A rejection driven purely by warnings must not read "0 fatal, 0 error(s)".
    const r = report({
      valid: false,
      counts: { FATAL: 0, ERROR: 0, WARNING: 3, INFO: 2, USAGE: 0 },
      messages: [
        { id: 'PKG-001', severity: 'WARNING', message: 'a' },
        { id: 'PKG-002', severity: 'WARNING', message: 'b' },
        { id: 'PKG-003', severity: 'WARNING', message: 'c' },
        { id: 'ACC-001', severity: 'INFO', message: 'd' },
        { id: 'ACC-002', severity: 'INFO', message: 'e' },
      ] as Report['messages'],
    });
    mockValidate.mockResolvedValue(r);

    const err = await assertValidEpub(Buffer.from('x'), 'WARNING').catch((e) => e);
    expect(err.threshold).toBe('WARNING');
    // INFO is below the WARNING floor, so it is not part of the blocking summary.
    expect(err.message).toBe('EPUB failed validation (threshold WARNING): 3 warning');
  });

  it('under WARNING, also reports WARNING messages', async () => {
    const r = report({
      valid: false,
      counts: { FATAL: 0, ERROR: 1, WARNING: 1, INFO: 1, USAGE: 0 },
      messages: [
        { id: 'RSC-005', severity: 'ERROR', message: 'parse error' },
        { id: 'PKG-001', severity: 'WARNING', message: 'version mismatch' },
        { id: 'ACC-001', severity: 'INFO', message: 'no accessibility metadata' },
      ] as Report['messages'],
    });
    mockValidate.mockResolvedValue(r);

    const err = await assertValidEpub(Buffer.from('x'), 'WARNING').catch((e) => e);
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual([
      'RSC-005',
      'PKG-001',
      'ACC-001',
    ]);
  });

  it('under INFO, also reports INFO messages', async () => {
    const r = report({
      valid: false,
      counts: { FATAL: 0, ERROR: 0, WARNING: 1, INFO: 1, USAGE: 1 },
      messages: [
        { id: 'PKG-001', severity: 'WARNING', message: 'version mismatch' },
        { id: 'ACC-001', severity: 'INFO', message: 'no accessibility metadata' },
        { id: 'CSS-999', severity: 'USAGE', message: 'unused style' },
      ] as Report['messages'],
    });
    mockValidate.mockResolvedValue(r);

    const err = await assertValidEpub(Buffer.from('x'), 'INFO').catch((e) => e);
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual([
      'PKG-001',
      'ACC-001',
      'CSS-999',
    ]);
  });
});

describe('formatMessages', () => {
  it('preserves line and column when present', () => {
    const out = formatMessages([
      {
        id: 'RSC-005',
        severity: 'ERROR',
        message: 'parse error',
        location: { path: 'content.opf', line: 12, column: 4 },
      },
    ] as Message[]);
    expect(out[0].location).toEqual({ path: 'content.opf', line: 12, column: 4 });
  });

  it('keeps just the path when there is no line', () => {
    const out = formatMessages([
      { id: 'PKG-006', severity: 'FATAL', message: 'bad mimetype', location: { path: 'mimetype' } },
    ] as Message[]);
    expect(out[0].location).toEqual({ path: 'mimetype' });
  });

  it('drops the location when the path is empty or absent', () => {
    const out = formatMessages([
      { id: 'X', severity: 'INFO', message: 'x', location: { path: '' } },
      { id: 'Y', severity: 'INFO', message: 'y' },
    ] as Message[]);
    expect(out[0].location).toBeUndefined();
    expect(out[1].location).toBeUndefined();
  });

  it('splits the message into subject segments with quotes stripped', () => {
    const out = formatMessages([
      {
        id: 'RSC-007',
        severity: 'ERROR',
        message: 'Referenced resource "text/001-ch1.xhtml#pg-11" could not be found in the EPUB.',
      },
    ] as Message[]);
    expect(out[0].segments).toEqual([
      { text: 'Referenced resource ' },
      { text: 'text/001-ch1.xhtml#pg-11', subject: true },
      { text: ' could not be found in the EPUB.' },
    ]);
  });
});

describe('splitSubjects', () => {
  it('extracts a single quoted subject and strips the quotes', () => {
    expect(splitSubjects('Referenced resource "a/b.xhtml" could not be found.')).toEqual([
      { text: 'Referenced resource ' },
      { text: 'a/b.xhtml', subject: true },
      { text: ' could not be found.' },
    ]);
  });

  it('extracts multiple quoted subjects', () => {
    expect(splitSubjects('"a.xhtml" conflicts with "b.xhtml"')).toEqual([
      { text: 'a.xhtml', subject: true },
      { text: ' conflicts with ' },
      { text: 'b.xhtml', subject: true },
    ]);
  });

  it('returns a single plain run when there are no quotes', () => {
    expect(splitSubjects('unreadable EPUB')).toEqual([{ text: 'unreadable EPUB' }]);
  });

  it('leaves an unbalanced trailing quote as plain text', () => {
    expect(splitSubjects('missing "close')).toEqual([{ text: 'missing "close' }]);
  });
});

const RAW = {
  valid: false,
  counts: { FATAL: 0, ERROR: 1, WARNING: 1, INFO: 0, USAGE: 0 },
  messages: [
    {
      id: 'OPF-014',
      severity: 'ERROR',
      message: 'Bad "value" here',
      location: { path: 'a.opf', line: 3, column: 5 },
    },
    { id: 'HTM-004', severity: 'WARNING', message: 'plain note' },
  ],
};

describe('toValidationReport', () => {
  it('maps a raw report into the stored shape with formatted messages', () => {
    const out = toValidationReport(RAW as never, 'ERROR');
    expect(out.valid).toBe(false);
    expect(out.threshold).toBe('ERROR');
    expect(out.counts).toEqual(RAW.counts);
    expect(out.messages[0]).toMatchObject({
      id: 'OPF-014',
      severity: 'ERROR',
      location: { path: 'a.opf', line: 3, column: 5 },
    });
    // "value" becomes a subject segment
    expect(out.messages[0].segments).toEqual([
      { text: 'Bad ' },
      { text: 'value', subject: true },
      { text: ' here' },
    ]);
    expect(out.messages[1].segments).toEqual([{ text: 'plain note' }]);
  });
});

describe('validateEpubReport', () => {
  it('runs validateEpub and maps the result', async () => {
    mockValidateEpub.mockResolvedValue(RAW);
    const out = await validateEpubReport(Buffer.from('x'), 'WARNING');
    expect(mockValidateEpub).toHaveBeenCalledWith(Buffer.from('x'), { threshold: 'WARNING' });
    expect(out.valid).toBe(false);
    expect(out.threshold).toBe('WARNING');
    expect(out.messages).toHaveLength(2);
  });
});
