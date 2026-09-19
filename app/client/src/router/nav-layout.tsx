import { Outlet } from 'react-router';

import { LibrarySwitcher } from '~/component/library-switcher';
import { Nav } from '~/component/nav';
import { TopFade } from '~/component/top-fade';
import { isStandalone } from '~/lib/is-standalone';
import { useIsAdmin } from '~/provider/auth';

import { useStyle } from './nav-layout-style';

// Persistent layout for the main (nav-bearing) routes. Rendering <Nav /> here —
// rather than inside each page's <Page> — keeps it mounted across navigations, so
// the mobile nav's active-tab lens animates from the old tab to the new one instead
// of re-mounting and jumping into place.
//
// <LibrarySwitcher /> is here for the same reason and three more. It is global
// chrome — the admin's "whose library am I working in" selection — not page
// content, so it belongs above the nav rather than inside any one page:
//
//   - `component/page` renders INSIDE `<main>`, below the desktop nav
//     `<header>`. A slot there could not put the picker ABOVE the navigation
//     at all; it would land underneath it.
//   - `component/page` also serves the nav-less forced-password-change screen
//     (`page/password-reset` uses `<Page type="minimal">`). An admin stuck
//     there should not be switching libraries; this layout excludes it,
//     because `password-reset` is routed outside it.
//   - A `Page` slot would remount on every navigation, and would make every
//     page opt in by passing a prop — or render unconditionally, in which case
//     it is not a slot at all.
//
// This layout DOES branch on `isAdmin`, despite `LibrarySwitcher` already
// returning `null` for a non-admin on its own. The two gates answer different
// questions: the component's is "do I render a control", and this one is "does
// the separator band exist at all". While the wrapper was invisible chrome an
// empty one cost nothing; now that it carries a visible rule, an empty band
// would draw a line above a picker that is not there. `&:empty` cannot express
// it either — the band has a child, so it is never `:empty`.
export const NavLayout = () => {
  const styles = useStyle();
  const [isAdmin] = useIsAdmin();

  return (
    <>
      {/* Two elements on purpose: the BAND spans the viewport and carries the
          rule, so the picker reads as a band of global chrome above the page
          rather than as content divided from other content; the inner box is
          constrained to the same width and gutter `component/page`'s `<main>`
          uses, so the picker itself still lines up with page content. */}
      {isAdmin && (
        <div className={styles.switcherBand}>
          <div className={styles.switcher}>
            <LibrarySwitcher />
          </div>
        </div>
      )}
      <Nav />
      {/* The top status-bar fade is only relevant when installed (standalone); in a
          browser tab the OS status bar isn't drawn over the page. */}
      {isStandalone() && <TopFade />}
      <Outlet />
    </>
  );
};
