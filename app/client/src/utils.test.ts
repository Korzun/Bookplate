import {
  areObjectArraysIdentical,
  areStringArraysIdentical,
  formatSize,
  formatTimestamp,
  generateUUID,
  relativeTime,
} from './utils';

describe('generateUUID', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('returns a valid v4 UUID', () => {
    expect(generateUUID()).toMatch(UUID_RE);
  });

  it('returns a unique value each call', () => {
    expect(generateUUID()).not.toBe(generateUUID());
  });

  it('falls back when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error simulating non-secure context
    crypto.randomUUID = undefined;
    try {
      expect(generateUUID()).toMatch(UUID_RE);
    } finally {
      crypto.randomUUID = original;
    }
  });
});

describe('formatSize', () => {
  it('formats bytes', () => expect(formatSize(500)).toBe('500 B'));
  it('formats kilobytes', () => expect(formatSize(1536)).toBe('1.5 KB'));
  it('formats megabytes', () => expect(formatSize(1_048_576)).toBe('1.0 MB'));
});

describe('areObjectArraysIdentical', () => {
  type Id = { scheme: string; value: string };

  it('returns true for the same reference', () => {
    const arr: Id[] = [{ scheme: 'isbn', value: '123' }];
    expect(areObjectArraysIdentical(arr, arr)).toBe(true);
  });
  it('returns true for two empty arrays', () => {
    expect(areObjectArraysIdentical([], [])).toBe(true);
  });
  it('returns true for equal arrays in the same order', () => {
    const a: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'uuid', value: '2' },
    ];
    const b: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'uuid', value: '2' },
    ];
    expect(areObjectArraysIdentical(a, b)).toBe(true);
  });
  it('returns true for equal arrays in different order', () => {
    const a: Id[] = [
      { scheme: 'uuid', value: '2' },
      { scheme: 'isbn', value: '1' },
    ];
    const b: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'uuid', value: '2' },
    ];
    expect(areObjectArraysIdentical(a, b)).toBe(true);
  });
  it('returns false when a field value differs', () => {
    const a: Id[] = [{ scheme: 'isbn', value: '1' }];
    const b: Id[] = [{ scheme: 'isbn', value: '2' }];
    expect(areObjectArraysIdentical(a, b)).toBe(false);
  });
  it('returns false for arrays with different lengths', () => {
    const a: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'uuid', value: '2' },
    ];
    const b: Id[] = [{ scheme: 'isbn', value: '1' }];
    expect(areObjectArraysIdentical(a, b)).toBe(false);
  });
  it('is not fooled by duplicate objects covering for a missing one', () => {
    const a: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'isbn', value: '1' },
    ];
    const b: Id[] = [
      { scheme: 'isbn', value: '1' },
      { scheme: 'uuid', value: '2' },
    ];
    expect(areObjectArraysIdentical(a, b)).toBe(false);
  });
});

describe('areStringArraysIdentical', () => {
  it('returns true for the same reference', () => {
    const arr = ['a', 'b'];
    expect(areStringArraysIdentical(arr, arr)).toBe(true);
  });
  it('returns true for two empty arrays', () => {
    expect(areStringArraysIdentical([], [])).toBe(true);
  });
  it('returns true for equal arrays in the same order', () => {
    expect(areStringArraysIdentical(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
  });
  it('returns true for equal arrays in different order', () => {
    expect(areStringArraysIdentical(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(true);
  });
  it('returns false for arrays with different elements', () => {
    expect(areStringArraysIdentical(['a', 'b'], ['a', 'x'])).toBe(false);
  });
  it('returns false for arrays with different lengths', () => {
    expect(areStringArraysIdentical(['a', 'b'], ['a'])).toBe(false);
  });
  it('returns false when one array has a superset of the other', () => {
    expect(areStringArraysIdentical(['a', 'b', 'c'], ['a', 'b', 'b'])).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('returns an empty array for undefined', () => {
    expect(formatTimestamp(undefined)).toEqual([]);
  });

  it('returns exactly two strings for a valid timestamp', () => {
    const result = formatTimestamp(new Date('2024-03-15T10:30:00Z').getTime());
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('string');
    expect(typeof result[1]).toBe('string');
  });

  it('includes the year in the date part', () => {
    const [date] = formatTimestamp(new Date('2024-03-15T10:30:00Z').getTime());
    expect(date).toContain('2024');
  });

  it('formats the time part as HH:MM', () => {
    const [, time] = formatTimestamp(new Date('2024-03-15T10:30:00Z').getTime());
    expect(time).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('relativeTime', () => {
  it('returns "just now" for less than 60 seconds', () => {
    const ts = Math.floor(Date.now() / 1000) - 30;
    expect(relativeTime(ts)).toBe('just now');
  });
  it('returns minutes ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 120;
    expect(relativeTime(ts)).toBe('2m ago');
  });
  it('returns hours ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 7200;
    expect(relativeTime(ts)).toBe('2h ago');
  });
  it('returns days ago', () => {
    const ts = Math.floor(Date.now() / 1000) - 172_800;
    expect(relativeTime(ts)).toBe('2d ago');
  });
});
