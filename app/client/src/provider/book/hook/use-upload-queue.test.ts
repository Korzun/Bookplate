import { describe, expect, it } from 'vitest';

import { fixKey } from './use-upload-queue';

describe('fixKey', () => {
  it('identifies a fix by field, kind, and from', () => {
    expect(
      fixKey({ field: 'authorSort', kind: 'author-sort-missing', from: '', to: 'X', changes: {} })
    ).toBe('authorSort:author-sort-missing:');
  });

  it('distinguishes two subject-split fixes by their compound', () => {
    const a = { field: 'subjects', kind: 'subjects-split', from: 'A & B', to: 'A, B', changes: {} };
    const b = { field: 'subjects', kind: 'subjects-split', from: 'C & D', to: 'C, D', changes: {} };
    expect(fixKey(a)).not.toBe(fixKey(b));
  });
});
