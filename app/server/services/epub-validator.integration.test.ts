import { assertValidEpub, EpubValidationError } from './epub-validator';

// No jest.mock here: this exercises the real @korzun/epubcheck-ts package
// end-to-end, confirming the dual-format CJS build is wired and callable under ts-jest.
describe('assertValidEpub (real @korzun/epubcheck-ts)', () => {
  it('rejects bytes that are not a valid EPUB archive', async () => {
    const err = await assertValidEpub(Buffer.from('definitely not a zip'), 'ERROR').catch((e) => e);
    expect(err).toBeInstanceOf(EpubValidationError);
    expect(err.messages.length).toBeGreaterThan(0);
  });
});
