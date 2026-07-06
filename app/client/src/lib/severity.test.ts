import { describe, expect, it } from 'vitest';

import {
  isBlockingAtThreshold,
  orderSeverityCounts,
  SEVERITY_LABEL,
  THRESHOLD_LABEL,
} from './severity';

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

describe('isBlockingAtThreshold', () => {
  it('treats a severity at or above the threshold as blocking', () => {
    expect(isBlockingAtThreshold('FATAL', 'ERROR')).toBe(true);
    expect(isBlockingAtThreshold('ERROR', 'ERROR')).toBe(true);
    expect(isBlockingAtThreshold('WARNING', 'WARNING')).toBe(true);
    expect(isBlockingAtThreshold('FATAL', 'WARNING')).toBe(true);
  });

  it('treats a severity below the threshold as non-blocking', () => {
    expect(isBlockingAtThreshold('WARNING', 'ERROR')).toBe(false);
    expect(isBlockingAtThreshold('INFO', 'WARNING')).toBe(false);
    expect(isBlockingAtThreshold('USAGE', 'FATAL')).toBe(false);
  });

  it('treats nothing as blocking when the threshold is NONE', () => {
    expect(isBlockingAtThreshold('FATAL', 'NONE')).toBe(false);
    expect(isBlockingAtThreshold('USAGE', 'NONE')).toBe(false);
  });
});

describe('SEVERITY_LABEL', () => {
  it('maps each severity to a title-cased label', () => {
    expect(SEVERITY_LABEL.FATAL).toBe('Fatal');
    expect(SEVERITY_LABEL.USAGE).toBe('Usage');
  });
});

describe('THRESHOLD_LABEL', () => {
  it('labels every threshold, including NONE', () => {
    expect(THRESHOLD_LABEL.ERROR).toBe('Error');
    expect(THRESHOLD_LABEL.WARNING).toBe('Warning');
    expect(THRESHOLD_LABEL.NONE).toBe('None');
  });
});
