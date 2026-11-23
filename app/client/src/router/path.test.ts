import { matchRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { path } from './index';
import * as pathInternal from './path-internal';
import * as pathKey from './path-key-internal';

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

describe('path.collection', () => {
  it.each(["The Guardian's Best 100 Novels in English (2015)", 'A/B?C#D&E'])(
    'round-trips %s through the route param',
    (name) => {
      // `matchRoutes` is what the router runs on the location's pathname.
      const matches = matchRoutes(
        [{ path: pathInternal.collection(pathKey.collectionName) }],
        path.collection(name)
      );
      expect(matches?.[0].params.name).toBe(name);
    }
  );
});
