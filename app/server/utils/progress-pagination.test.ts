import { decodeProgressCursor, parseProgressTake } from './progress-pagination';

describe('decodeProgressCursor', () => {
  it('round-trips a base64 JSON cursor', () => {
    const raw = Buffer.from(JSON.stringify({ timestamp: 10, document: 'd1' })).toString('base64');
    expect(decodeProgressCursor(raw)).toEqual({ timestamp: 10, document: 'd1' });
  });

  it('returns null for non-string input', () => {
    expect(decodeProgressCursor(undefined)).toBeNull();
    expect(decodeProgressCursor(123)).toBeNull();
  });

  it('returns null for malformed base64/JSON', () => {
    expect(decodeProgressCursor('!!!not-base64-json')).toBeNull();
  });

  it('returns null when fields are the wrong shape', () => {
    const raw = Buffer.from(JSON.stringify({ timestamp: 'x', document: 1 })).toString('base64');
    expect(decodeProgressCursor(raw)).toBeNull();
  });
});

describe('parseProgressTake', () => {
  it('defaults to 50 when absent', () => {
    expect(parseProgressTake(undefined)).toBe(50);
  });

  it('clamps to [1, 100]', () => {
    expect(parseProgressTake('0')).toBe(1);
    expect(parseProgressTake('500')).toBe(100);
    expect(parseProgressTake('25')).toBe(25);
  });

  it('falls back to 50 for non-numeric strings', () => {
    expect(parseProgressTake('abc')).toBe(50);
  });
});
