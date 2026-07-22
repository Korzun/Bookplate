import { describe, expect, it } from 'vitest';

import { fixKey } from './use-upload-queue';

describe('fixKey', () => {
  it('identifies a fix by field and kind', () => {
    expect(
      fixKey({ field: 'authorSort', kind: 'author-sort-missing', from: '', to: 'X', changes: {} })
    ).toBe('authorSort:author-sort-missing');
  });
});
