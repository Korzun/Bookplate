import type { Report } from 'epubcheck-ts';
import { validateEpub } from 'epubcheck-ts';
import { assertValidEpub, EpubValidationError } from './epub-validator';

jest.mock('epubcheck-ts', () => ({ validateEpub: jest.fn() }));

const mockValidate = validateEpub as jest.MockedFunction<typeof validateEpub>;

function report(partial: Partial<Report>): Report {
  return {
    messages: [],
    counts: { FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 },
    fatal: false,
    valid: true,
    ...partial,
  };
}

describe('assertValidEpub', () => {
  beforeEach(() => mockValidate.mockReset());

  it('returns the report when valid', async () => {
    const r = report({
      valid: true,
      counts: { FATAL: 0, ERROR: 0, WARNING: 2, INFO: 0, USAGE: 0 },
    });
    mockValidate.mockResolvedValue(r);
    await expect(assertValidEpub(Buffer.from('x'))).resolves.toBe(r);
  });

  it('throws EpubValidationError carrying only ERROR/FATAL messages when invalid', async () => {
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

    const err = await assertValidEpub(Buffer.from('x')).catch((e) => e);
    expect(err).toBeInstanceOf(EpubValidationError);
    expect(err.messages.map((m: { id: string }) => m.id)).toEqual(['PKG-003', 'RSC-005']);
    expect(err.counts).toEqual(r.counts);
  });
});
