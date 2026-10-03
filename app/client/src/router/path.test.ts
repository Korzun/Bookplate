import { describe, expect, it } from 'vitest';

import { path } from './index';

describe('path', () => {
  /**
   * Request moved out from under Add when the two became separate nav
   * destinations. These pin the shape rather than the strings for their own
   * sake: `component/nav` matches the Add tab with `pathname === path.upload()`
   * precisely because `/request` is no longer BELOW `/add`, and that exact
   * match is what stops both tabs lighting at once. If the two ever became
   * nested again, the nav would silently regress and this is the cheapest
   * place to catch it.
   */
  it('makes request a sibling of upload, not a child', () => {
    expect(path.upload()).toBe('/upload');
    expect(path.request()).toBe('/request');
    expect(path.request().startsWith(`${path.upload()}/`)).toBe(false);
  });

  /**
   * The URL Request used to live at. It exists ONLY to be redirected
   * (`router/component.tsx`); a reader who bookmarked the old view, or an
   * admin who sent someone the link, would otherwise hit the catch-all bounce
   * to the library, which reads as "the feature was removed".
   */
  it('keeps the legacy URLs pointing at the old locations', () => {
    expect(path.legacyAdd()).toBe('/add');
    expect(path.legacyAddRequest()).toBe('/add/request');
    // They exist only to be redirected, so they must NOT equal what they
    // redirect to — a legacy constant quietly updated to the new value would
    // make its `<Route>` shadow the real one.
    expect(path.legacyAdd()).not.toBe(path.upload());
    expect(path.legacyAddRequest()).not.toBe(path.request());
  });
});
