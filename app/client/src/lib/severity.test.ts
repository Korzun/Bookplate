import { describe, expect, it } from 'vitest';

import { isBlocking, orderSeverityCounts, SEVERITY_LABEL } from './severity';

describe('orderSeverityCounts', () => {
  it('returns only non-zero severities in canonical order', () => {
    const result = orderSeverityCounts({ USAGE: 2, FATAL: 1, ERROR: 0, WARNING: 3, INFO: 0 });
    expect(result).toEqual([
      { severity: 'FATAL', count: 1 },
      { severity: 'WARNING', count: 3 },
      { severity: 'USAGE', count: 2 },
    ]);
  });

  it('returns an empty array when all counts are zero', () => {
    expect(orderSeverityCounts({ FATAL: 0, ERROR: 0, WARNING: 0, INFO: 0, USAGE: 0 })).toEqual([]);
  });
});

describe('isBlocking', () => {
  it('treats FATAL and ERROR as blocking', () => {
    expect(isBlocking('FATAL')).toBe(true);
    expect(isBlocking('ERROR')).toBe(true);
  });

  it('treats WARNING, INFO and USAGE as non-blocking', () => {
    expect(isBlocking('WARNING')).toBe(false);
    expect(isBlocking('INFO')).toBe(false);
    expect(isBlocking('USAGE')).toBe(false);
  });
});

describe('SEVERITY_LABEL', () => {
  it('maps each severity to a title-cased label', () => {
    expect(SEVERITY_LABEL.FATAL).toBe('Fatal');
    expect(SEVERITY_LABEL.USAGE).toBe('Usage');
  });
});
