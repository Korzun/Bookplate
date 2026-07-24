import { afterEach, describe, expect, it } from 'vitest';

import type { UploadItem } from '~/provider/book';

import {
  isWorthPersisting,
  loadQueue,
  saveQueue,
  serializeQueue,
  STORAGE_KEY,
} from './persistence';

function item(overrides: Partial<UploadItem>): UploadItem {
  return {
    id: '1',
    fileName: 'a.epub',
    fileSize: 100,
    status: 'done',
    bytesUploaded: 100,
    ...overrides,
  };
}

afterEach(() => localStorage.clear());

describe('isWorthPersisting', () => {
  it('true when proposals pending', () => {
    expect(isWorthPersisting(item({ proposals: [{} as never] }))).toBe(true);
  });
  it('true when an undo is armed', () => {
    expect(
      isWorthPersisting(item({ undo: { kind: 'dismiss', proposals: [], appliedFixes: [] } }))
    ).toBe(true);
  });
  it('false when resolved (no proposals, no undo)', () => {
    expect(isWorthPersisting(item({ proposals: [] }))).toBe(false);
  });
  it('false for a queued/uploading item', () => {
    expect(isWorthPersisting(item({ status: 'uploading' }))).toBe(false);
  });
});

describe('serializeQueue', () => {
  it('drops the File blob, forces done, sets bytesUploaded to fileSize', () => {
    const live = item({
      status: 'done',
      file: new File(['x'], 'a.epub'),
      fileSize: 100,
      bytesUploaded: 0,
      proposals: [{} as never],
    });
    const [out] = serializeQueue([live]);
    expect('file' in out).toBe(false);
    expect(out.status).toBe('done');
    expect(out.bytesUploaded).toBe(100);
  });
  it('keeps only worth-persisting items', () => {
    const keep = item({ id: 'k', proposals: [{} as never] });
    const drop = item({ id: 'd', proposals: [] });
    expect(serializeQueue([keep, drop]).map((i) => i.id)).toEqual(['k']);
  });
});

describe('save/load round-trip', () => {
  it('persists the worth-keeping subset and reloads it without a File', () => {
    const keep = item({ id: 'k', file: new File(['x'], 'a.epub'), proposals: [{} as never] });
    saveQueue([keep, item({ id: 'd', proposals: [] })]);
    const loaded = loadQueue();
    expect(loaded.map((i) => i.id)).toEqual(['k']);
    expect(loaded[0].file).toBeUndefined();
    expect(loaded[0].status).toBe('done');
  });
  it('removes the key when nothing is worth persisting', () => {
    localStorage.setItem(STORAGE_KEY, '[{"id":"old"}]');
    saveQueue([item({ proposals: [] })]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it('returns [] on absent storage', () => {
    expect(loadQueue()).toEqual([]);
  });
  it('returns [] on malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not json{');
    expect(loadQueue()).toEqual([]);
  });
  it('drops elements with a malformed shape', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'ok', fileName: 'a.epub', fileSize: 1, status: 'done', bytesUploaded: 1 },
        { id: 'bad' },
      ])
    );
    const loaded = loadQueue();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('ok');
  });
});
