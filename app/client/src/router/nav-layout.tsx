import { Outlet } from 'react-router';

import { LibrarySwitcher } from '~/component/library-switcher';
import { Nav } from '~/component/nav';
import { TopFade } from '~/component/top-fade';
import { isStandalone } from '~/lib/is-standalone';

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
// No `isAdmin` branch here: `LibrarySwitcher` returns `null` for a non-admin on
// its own, and this layout sits inside `ProtectedRoute`, so "every logged-in
// nav-bearing page, admins only" falls out without a condition.
export const NavLayout = () => {
  const styles = useStyle();

  return (
    <>
      {/* Constrained to the same width and gutter `component/page`'s `<main>`
          uses, so the picker lines up with page content instead of floating
          full-bleed across the viewport. */}
      <div className={styles.switcher}>
        <LibrarySwitcher />
      </div>
      <Nav />
      {/* The top status-bar fade is only relevant when installed (standalone); in a
          browser tab the OS status bar isn't drawn over the page. */}
      {isStandalone() && <TopFade />}
      <Outlet />
    </>
  );
};
