import { describe, expect, it } from 'vitest';

import { path } from './index';

describe('path', () => {
  /**
   * Upload and Request are separate destinations, named for what they do.
   * This pins the SHAPE rather than the strings for their own sake:
   * `component/nav` matches the Upload tab with `pathname === path.upload()`
   * precisely because `/request` is not BELOW `/upload`, and that exact match
   * is what stops both tabs lighting at once. Nest them again and the nav
   * regresses silently; this is the cheapest place to catch it.
   */
  it('makes request a sibling of upload, not a child', () => {
    expect(path.upload()).toBe('/upload');
    expect(path.request()).toBe('/request');
    expect(path.request().startsWith(`${path.upload()}/`)).toBe(false);
  });
});
