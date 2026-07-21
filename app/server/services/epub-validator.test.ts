import type { Report } from '@korzun/epubcheck-ts';
import { validateEpub } from '@korzun/epubcheck-ts';
import type { MockedFunction } from 'vitest';

import { assertValidEpub, EpubValidationError } from './epub-validator';

vi.mock('@korzun/epubcheck-ts', () => ({ validateEpub: vi.fn() }));

const mockValidate = validateEpub as MockedFunction<typeof validateEpub>;

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

  it('under ERROR, reports only FATAL/ERROR messages', async () => {
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
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual(['PKG-003', 'RSC-005']);
    expect(err.counts).toEqual(r.counts);
    expect(err.threshold).toBe('ERROR');
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
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual(['RSC-005', 'PKG-001']);
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
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual(['PKG-001', 'ACC-001']);
  });
});
