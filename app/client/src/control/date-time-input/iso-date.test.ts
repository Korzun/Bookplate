import { describe, expect, it } from 'vitest';

import { composeIsoDate, splitIsoDate } from './iso-date';

describe('splitIsoDate', () => {
  it('returns empty parts for an empty or missing value', () => {
    expect(splitIsoDate(undefined)).toEqual({ date: '', time: '' });
    expect(splitIsoDate('')).toEqual({ date: '', time: '' });
  });

  it('keeps a plain date and leaves the time empty', () => {
    expect(splitIsoDate('2023-06-06')).toEqual({ date: '2023-06-06', time: '' });
  });

  it('fills a year-only value out to the first of January', () => {
    expect(splitIsoDate('1965')).toEqual({ date: '1965-01-01', time: '' });
  });

  it('fills a year-month value out to the first of the month', () => {
    expect(splitIsoDate('1965-08')).toEqual({ date: '1965-08-01', time: '' });
  });

  it('splits a UTC timestamp into its date and minute-precision time', () => {
    expect(splitIsoDate('2021-01-01T16:00:00+00:00')).toEqual({
      date: '2021-01-01',
      time: '16:00',
    });
    expect(splitIsoDate('2026-01-27T17:05:30.250Z')).toEqual({
      date: '2026-01-27',
      time: '17:05',
    });
  });

  it('converts a timestamp with a non-UTC offset to UTC', () => {
    expect(splitIsoDate('2015-08-04T22:30:00-05:00')).toEqual({
      date: '2015-08-05',
      time: '03:30',
    });
  });

  it('treats a timestamp without an offset as UTC', () => {
    expect(splitIsoDate('2015-08-04T22:30')).toEqual({ date: '2015-08-04', time: '22:30' });
  });

  it('returns empty parts for a value it cannot read', () => {
    expect(splitIsoDate('June 2023')).toEqual({ date: '', time: '' });
    expect(splitIsoDate('2023-13-45')).toEqual({ date: '', time: '' });
  });
});

describe('composeIsoDate', () => {
  it('returns undefined when there is no date, even if a time is set', () => {
    expect(composeIsoDate('', '')).toBeUndefined();
    expect(composeIsoDate('', '16:00')).toBeUndefined();
  });

  it('returns the bare date when there is no time', () => {
    expect(composeIsoDate('2023-06-06', '')).toBe('2023-06-06');
  });

  it('returns a UTC timestamp at second precision when a time is set', () => {
    expect(composeIsoDate('2023-06-06', '16:00')).toBe('2023-06-06T16:00:00Z');
  });
});
