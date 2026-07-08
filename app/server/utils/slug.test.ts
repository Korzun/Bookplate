import { generateSlug } from './slug';

describe('generateSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(generateSlug('Kindle PW')).toBe('kindle-pw');
  });
  it('strips special characters', () => {
    expect(generateSlug('Kobo!! (Clara)')).toBe('kobo-clara');
  });
  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  --Boox--  ')).toBe('boox');
  });
  it('collapses runs of separators', () => {
    expect(generateSlug('a   b___c')).toBe('a-b-c');
  });
});
